import { DatabaseSync } from "node:sqlite";
import { Client } from "pg";
import { Prisma } from "@prisma/client";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const sqlType = {
  String: "text", Int: "integer", Float: "double precision",
  Boolean: "boolean", DateTime: "timestamp(3) without time zone", Json: "jsonb",
};
const sqliteType = { String: "TEXT", Int: "INTEGER", Float: "REAL", Boolean: "BOOLEAN", DateTime: "DATETIME", Json: "JSONB" };
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const target = (name) => "public." + quote(name);
const signature = (items) => JSON.stringify(items);
const sorted = (items) => items.map(signature).sort().join("\n");
const actionCode = { Cascade: "c", SetNull: "n", SetDefault: "d", Restrict: "r", NoAction: "a" };

class TransferError extends Error {}
function requireCheck(condition, message) {
  if (!condition) throw new TransferError(message);
}

function getModels() {
  const pending = Prisma.dmmf.datamodel.models.map((model) => {
    const fields = model.fields.filter((field) => field.kind !== "object");
    requireCheck(!model.dbName && !model.primaryKey && fields.every((field) =>
      field.kind === "scalar" && sqlType[field.type] && !field.isList && !field.dbName
      && !field.nativeType && (!field.isId || field.type === "String")), "Unsupported model or field definition.");
    requireCheck(fields.filter((field) => field.isId).length === 1 && fields.some((field) =>
      field.isId && field.name === "id"), "Expected a single text ID.");
    const uniques = [ ["id"], ...fields.filter((field) => field.isUnique).map((field) => [field.name]), ...model.uniqueFields ];
    const foreignKeys = model.fields.filter((field) => field.relationFromFields?.length).map((field) => [
      field.relationFromFields, field.type, field.relationToFields, actionCode[field.relationOnDelete], actionCode[field.relationOnUpdate ?? "Cascade"],
    ]);
    return { name: model.name, fields, uniques, foreignKeys };
  });
  const ordered = [];
  while (pending.length) {
    const index = pending.findIndex((model) => model.foreignKeys.every(([, parent]) => ordered.some((item) => item.name === parent)));
    requireCheck(index >= 0, "Unsupported cyclic or unresolved table dependency.");
    ordered.push(pending.splice(index, 1)[0]);
  }
  return ordered;
}

function inspectSource(db, models) {
  requireCheck(db.prepare("PRAGMA encoding").get().encoding === "UTF-8", "Expected a UTF-8 SQLite database.");
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'").all();
  requireCheck(sorted(tables.map((row) => row.name)) === sorted(models.map((model) => model.name)), "SQLite table inventory differs from the Prisma models.");
  requireCheck(db.prepare("PRAGMA quick_check").all().every((row) => row.quick_check === "ok"), "SQLite integrity check failed.");
  requireCheck(!db.prepare("PRAGMA foreign_key_check").get(), "SQLite contains a foreign-key violation.");
  for (const { name, fields } of models) {
    const columns = db.prepare(`PRAGMA table_xinfo(${quote(name)})`).all();
    requireCheck(sorted(columns.map((column) => [column.name, column.type.toUpperCase(), Boolean(column.pk), Boolean(column.notnull)])) ===
      sorted(fields.map((field) => [field.name, sqliteType[field.type], field.isId, field.isRequired])), `SQLite column definitions differ for ${name}.`);
  }
}

async function inspectDestination(db, models) {
  const tables = await db.query(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f') AND c.relname != '_prisma_migrations'
  `);
  requireCheck(sorted(tables.rows.map((row) => row.relname)) === sorted(models.map((model) => model.name)), "PostgreSQL table inventory differs from the Prisma models. Apply the PostgreSQL migrations first.");
  await db.query(`LOCK TABLE ${models.map(({ name }) => target(name)).join(", ")} IN ACCESS EXCLUSIVE MODE NOWAIT`);
  for (const { name, fields, uniques, foreignKeys } of models) {
    const relation = [target(name)];
    const columns = await db.query(`
      SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
             a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) AS default_value
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
    `, relation);
    requireCheck(sorted(columns.rows.map((row) => [row.attname, row.type, row.attnotnull])) ===
      sorted(fields.map((field) => [field.name, sqlType[field.type], field.isRequired])), `PostgreSQL column definitions differ for ${name}.`);
    requireCheck(columns.rows.every((row) => !row.attidentity && !row.attgenerated && !/nextval/i.test(row.default_value ?? "")), `Unsupported generated or sequence-backed column in ${name}.`);

    const indexes = await db.query(`
      SELECT i.indisprimary, to_jsonb(i)->>'indnullsnotdistinct' AS nulls_not_distinct, ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(num, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.num
        WHERE ord <= i.indnkeyatts ORDER BY ord) AS columns
      FROM pg_index i WHERE i.indrelid = $1::regclass AND i.indisunique
        AND i.indisvalid AND i.indisready AND i.indimmediate AND i.indpred IS NULL AND i.indexprs IS NULL
    `, relation);
    requireCheck(indexes.rows.every((row) => row.nulls_not_distinct !== "true") &&
      sorted(indexes.rows.map((row) => row.columns)) === sorted(uniques) &&
      indexes.rows.some((row) => row.indisprimary && signature(row.columns) === '["id"]'), `PostgreSQL primary or unique keys differ for ${name}.`);

    const references = await db.query(`
      SELECT p.relname AS parent_name, n.nspname AS parent_schema,
        c.convalidated, c.confdeltype, c.confupdtype,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num ORDER BY ord) AS source_columns,
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num, ord)
          JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num ORDER BY ord) AS target_columns
      FROM pg_constraint c JOIN pg_class p ON p.oid = c.confrelid JOIN pg_namespace n ON n.oid = p.relnamespace
      WHERE c.conrelid = $1::regclass AND c.contype = 'f'
    `, relation);
    requireCheck(references.rows.every((row) => row.convalidated && row.parent_schema === "public") &&
      sorted(references.rows.map((row) => [row.source_columns, row.parent_name, row.target_columns, row.confdeltype, row.confupdtype])) ===
      sorted(foreignKeys), `PostgreSQL foreign keys differ for ${name}.`);
    const behavior = await db.query(`
      SELECT relrowsecurity OR relhasrules OR relkind != 'r' OR
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = c.oid AND (NOT tgisinternal OR tgenabled NOT IN ('O', 'A'))) AS unsafe
      FROM pg_class c WHERE c.oid = $1::regclass
    `, relation);
    requireCheck(!behavior.rows[0].unsafe, `Unexpected PostgreSQL table behavior in ${name}.`);
    const { rows } = await db.query(`SELECT EXISTS (SELECT 1 FROM ${target(name)}) AS populated`);
    requireCheck(!rows[0].populated, `Destination table ${name} is populated. Use an empty migrated database.`);
  }
}

function convert(value, { type, isRequired }) {
  if (value instanceof Uint8Array) value = utf8.decode(value);
  if (typeof value === "bigint" && type !== "Json") {
    requireCheck(value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER), "SQLite integer exceeds the supported range.");
    value = Number(value);
  }
  if (value === null) {
    requireCheck(!isRequired, "Unexpected null in a required field.");
    return null;
  }
  if (type === "String" || type === "Json") {
    const jsonNumber = type === "Json" && (typeof value === "bigint" || Number.isFinite(value));
    requireCheck(typeof value === "string" || jsonNumber, "Unsupported SQLite text or JSON storage value.");
    requireCheck(jsonNumber || !value.includes("\u0000"), "PostgreSQL text cannot contain NUL.");
    return String(value);
  }
  if (type === "DateTime") {
    let input = value;
    if (typeof input === "string" && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(input)) {
      input = input.replace(" ", "T") + "Z";
    }
    requireCheck(Number.isSafeInteger(input) || (typeof input === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(input)), "Unsupported SQLite timestamp.");
    if (typeof input === "string") {
      // Date parsing can normalize an impossible calendar day into the next month.
      const calendar = new Date(input.slice(0, 10) + "T00:00:00Z");
      requireCheck(Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === input.slice(0, 10) &&
        Number(input.slice(11, 13)) < 24, "Invalid SQLite timestamp.");
    }
    const date = new Date(input);
    requireCheck(Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999, "Invalid SQLite timestamp.");
    return date.toISOString().slice(0, -1);
  }
  if (type === "Boolean") {
    requireCheck(value === 0 || value === 1, "Invalid SQLite boolean.");
    return value === 1;
  }
  requireCheck(Number.isFinite(value) && (type !== "Int" || Number.isInteger(value) && value >= -2147483648 && value <= 2147483647),
    "Invalid SQLite numeric value.");
  return value;
}

function* batches(db, model) {
  // Read text as bytes so invalid UTF-8 fails validation instead of being silently replaced.
  const columns = model.fields.map(({ name }) => {
    const col = quote(name);
    return `CASE WHEN typeof(${col}) = 'text' THEN CAST(${col} AS BLOB) ELSE ${col} END AS ${col}, typeof(${col}) AS ${quote("storage:" + name)}`;
  }).join(", ");
  const statement = db.prepare(`SELECT ${columns} FROM ${quote(model.name)} ORDER BY "id"`);
  statement.setReadBigInts(true);
  let batch = [];
  for (const row of statement.iterate()) {
    batch.push(model.fields.map((field) => {
      requireCheck(row["storage:" + field.name] !== "blob", "SQLite BLOB values are unsupported.");
      return convert(row[field.name], field);
    }));
    if (batch.length === 200) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

function valuesSql(batch, fields) {
  return batch.map((row, i) => "(" + row.map((_, j) => `$${i * fields.length + j + 1}::${sqlType[fields[j].type]}`).join(", ") + ")").join(", ");
}

export async function transfer({ source, destination, apply = false, allowRemote = false }) {
  let sqlite, pg;
  let stage = "configuration";
  const tables = [];
  try {
    requireCheck(source && destination, "Pass --source and set GMB_TRANSFER_POSTGRES_URL explicitly.");
    let url;
    try { url = new URL(destination); } catch { throw new TransferError("Invalid PostgreSQL connection URL."); }
    requireCheck(["postgresql:", "postgres:"].includes(url.protocol) && url.hostname && url.pathname.length > 1, "Specify a PostgreSQL host and database.");
    requireCheck(url.username && !url.hash && !url.hostname.includes("%") &&
      [...url.searchParams.keys()].every((key) => key === "sslmode") && url.searchParams.getAll("sslmode").length <= 1,
    "Use an explicit PostgreSQL user and only the sslmode query parameter.");
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    requireCheck(local || allowRemote && url.searchParams.get("sslmode") === "verify-full", "Remote transfer requires --allow-remote and sslmode=verify-full.");
    const models = getModels();
    stage = "SQLite schema and integrity";
    sqlite = new DatabaseSync(source, { readOnly: true });
    sqlite.exec("BEGIN");
    inspectSource(sqlite, models);

    stage = "PostgreSQL schema and empty destination";
    pg = new Client({ connectionString: url.href, connectionTimeoutMillis: 10_000 });
    pg.on("error", () => { /* The next query reports the connection failure without exposing its message. */ });
    await pg.connect();
    await pg.query("BEGIN");
    const replication = await pg.query("SHOW session_replication_role");
    requireCheck(replication.rows[0].session_replication_role === "origin", "PostgreSQL constraint enforcement requires origin replication mode.");
    await inspectDestination(pg, models);

    for (const model of models) {
      stage = `insert ${model.name}`;
      const columns = model.fields.map((field) => quote(field.name)).join(", ");
      let inserted = 0;
      for (const batch of batches(sqlite, model)) {
        const result = await pg.query(`INSERT INTO ${target(model.name)} (${columns}) VALUES ${valuesSql(batch, model.fields)}`, batch.flat());
        inserted += result.rowCount;
      }
      tables.push({ table: model.name, inserted });
    }

    await pg.query("SET CONSTRAINTS ALL IMMEDIATE");
    for (const [index, model] of models.entries()) {
      stage = `verify ${model.name}`;
      const columns = model.fields.map((field) => quote(field.name)).join(", ");
      const fieldsMatch = model.fields.map(({ name }) => `actual.${quote(name)} IS NOT DISTINCT FROM expected.${quote(name)}`).join(" AND ");
      let verified = 0;
      for (const batch of batches(sqlite, model)) {
        const { rows } = await pg.query(`
          WITH expected (${columns}) AS (VALUES ${valuesSql(batch, model.fields)})
          SELECT count(*)::text AS matched FROM expected JOIN ${target(model.name)} actual USING ("id")
          WHERE ${fieldsMatch}
        `, batch.flat());
        requireCheck(Number(rows[0].matched) === batch.length, `Primary key or field mismatch in ${model.name}.`);
        verified += batch.length;
      }
      const { rows } = await pg.query(`SELECT count(*)::text AS total FROM ${target(model.name)}`);
      const sourceCount = sqlite.prepare(`SELECT count(*) AS total FROM ${quote(model.name)}`).get().total;
      requireCheck(rows[0].total === String(sourceCount) && verified === sourceCount && tables[index].inserted === sourceCount, `Row count mismatch in ${model.name}.`);
      Object.assign(tables[index], { sourceCount, verifiedRows: verified,
        primaryKey: ["id"], uniqueKeys: model.uniques, foreignKeys: model.foreignKeys.length });
    }

    stage = apply ? "commit" : "dry-run rollback";
    await pg.query(apply ? "COMMIT" : "ROLLBACK");
    return { outcome: apply ? "committed" : "dry-run-rolled-back", tables, checks: "All primary keys and field values matched. PostgreSQL unique keys and foreign keys were verified and enforced. No sequence-backed columns." };
  } catch (error) {
    // Messages from either database can contain credentials or source values.
    const code = typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : undefined;
    const rolledBack = pg ? await pg.query("ROLLBACK").then(() => true, () => false) : true;
    return { outcome: "failed", stage, code, rollbackConfirmed: rolledBack && stage !== "commit",
      error: error instanceof TransferError ? error.message : "Database operation failed. See stage and error code." };
  } finally {
    sqlite?.close();
    await pg?.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { source: { type: "string" }, apply: { type: "boolean" }, "allow-remote": { type: "boolean" } } });
    const report = await transfer({ source: values.source, destination: process.env.GMB_TRANSFER_POSTGRES_URL, apply: values.apply, allowRemote: values["allow-remote"] });
    console.log(JSON.stringify(report, null, 2));
    if (report.outcome === "failed") process.exitCode = 1;
  } catch {
    console.error("Usage: npm run db:transfer -- --source PATH [--apply] [--allow-remote]");
    process.exitCode = 1;
  }
}
