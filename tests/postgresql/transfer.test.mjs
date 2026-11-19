import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { DEFAULT_POSITION } from "chess.js";
import { transfer } from "../../scripts/transfer-sqlite.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

const pgn = '[Event "Synthetic – test"]\n[White "Fixture"]\n[Black "Example"]\n[Result "*"]\n\n1. e4 e5 *';
const instant = "2026-11-19T15:32:09.567Z";
const overrides = {
  ChessGame: { pgn, initialFen: DEFAULT_POSITION, fingerprint: "fixture-fingerprint", lichessClock: '{"seconds":[299.125,null],"exact":9007199254740993}', lichessId: "test1234" },
  PlayerProfile: { displayName: "Synthetic profile", createdAt: "2026-11-19 15:32:09", updatedAt: Date.parse(instant) },
  GameAnalysis: { fen: DEFAULT_POSITION, ply: 0, scoreValue: 21, variation: '["e4","e5"]' },
  OpeningLine: { pgn },
  OpeningTrainingPosition: { repertoireId: "deleted-repertoire", chapterId: "deleted-chapter", applicable: 0, easeFactor: 2.625 },
};
const id = (name) => `fixture-${name}`;
const hash = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

async function seed(file) {
  const db = new DatabaseSync(file);
  try {
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    const entries = await readdir(migrations, { withFileTypes: true });
    for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
      db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"));
    }
    for (const model of Prisma.dmmf.datamodel.models) {
      const references = Object.fromEntries(model.fields.flatMap((field) =>
        (field.relationFromFields ?? []).map((column) => [column, id(field.type)])));
      const fields = model.fields.filter((field) => field.kind === "scalar");
      const defaults = { String: "synthetic", Int: 1, Float: 1.25, Boolean: 1, DateTime: Date.parse(instant) };
      const values = fields.map((field) => references[field.name] ??
        overrides[model.name]?.[field.name] ?? (field.isId ? id(model.name) : field.isRequired ? defaults[field.type] : null));
      db.prepare(`INSERT INTO "${model.name}" (${fields.map((field) => '"' + field.name + '"').join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...values);
      if (model.name === "ChessGame") {
        values[fields.findIndex((field) => field.isId)] = "fixture-manual-game";
        for (const column of ["lichessId", "lichessClock", "fingerprint"]) values[fields.findIndex((field) => field.name === column)] = null;
        db.prepare(`INSERT INTO "ChessGame" (${fields.map((field) => '"' + field.name + '"').join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...values);
      }
    }
    const extra = db.prepare(`
      INSERT INTO "TacticsAttempt" ("id", "puzzleId", "idempotencyKey", "submittedMoves", "firstAttemptCorrect", "solvingTimeMs", "completed")
      VALUES (?, ?, ?, '[]', 0, 100, 0)
    `);
    for (let index = 0; index < 200; index++) extra.run(`attempt-${index}`, id("TacticsPuzzle"), `key-${index}`);
  } finally {
    db.close();
  }
}
function edit(file, sql) {
  const db = new DatabaseSync(file);
  try { db.exec(sql); } finally { db.close(); }
}

test("transfers every model, verifies values, refuses populated targets, and rolls back conflicts", {
  skip: !process.env.GMB_TRANSFER_TEST_URL,
}, async () => {
  const destination = process.env.GMB_TRANSFER_TEST_URL;
  const url = new URL(destination);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/gmb_transfer_[a-z0-9_]+$/);
  const dir = await mkdtemp(join(tmpdir(), "gmb-transfer-"));
  const source = join(dir, "fixture.db");
  const broken = join(dir, "broken.db");
  const pg = new Client({ connectionString: destination });
  const appDb = new PrismaClient({ datasourceUrl: destination });
  const models = Prisma.dmmf.datamodel.models.map((model) => model.name);
  try {
    await seed(source);
    await seed(broken);
    const before = await hash(source);
    await pg.connect();
    const assertEmpty = async () => {
      for (const model of models) assert.equal((await pg.query(`SELECT count(*) AS n FROM "${model}"`)).rows[0].n, "0", model);
    };
    await assertEmpty();
    await pg.query('ALTER TABLE "ChessGame" ADD COLUMN unexpected text');
    const mismatch = await transfer({ source, destination, apply: true });
    assert.match(mismatch.error, /column definitions differ for ChessGame/);
    await pg.query('ALTER TABLE "ChessGame" DROP COLUMN unexpected');
    await assertEmpty();

    const script = fileURLToPath(new URL("../../scripts/transfer-sqlite.mjs", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [script, "--source", source], {
      env: { ...process.env, GMB_TRANSFER_POSTGRES_URL: destination },
    });
    const dry = JSON.parse(stdout);
    assert.equal(dry.outcome, "dry-run-rolled-back", JSON.stringify(dry));
    assert.equal(dry.tables.length, models.length);
    await assertEmpty();

    edit(broken, 'DROP INDEX "ChessGame_fingerprint_key"; UPDATE "ChessGame" SET fingerprint = \'fixture-fingerprint\'');
    const brokenBefore = await hash(broken);
    const conflict = await transfer({ source: broken, destination, apply: true });
    assert.equal(conflict.stage, "insert ChessGame");
    assert.equal(conflict.code, "23505");
    assert.equal(conflict.rollbackConfirmed, true);
    assert.equal(await hash(broken), brokenBefore);
    await assertEmpty();

    const applied = await transfer({ source, destination, apply: true });
    assert.equal(applied.outcome, "committed", JSON.stringify(applied));
    assert.deepEqual(applied.tables.map((item) => item.table).sort(), models.sort());
    assert.ok(applied.tables.every((item) => item.verifiedRows === (item.table === "TacticsAttempt" ? 201 : item.table === "ChessGame" ? 2 : 1)));
    const repeat = await transfer({ source, destination, apply: true });
    assert.equal(repeat.outcome, "failed");
    assert.match(repeat.error, /is populated/);

    const { listSavedGames } = await import("../../lib/games.ts");
    const { listGameAnalyses } = await import("../../lib/game-analysis.ts");
    const games = await listSavedGames(appDb);
    assert.equal(games.length, 2);
    assert.ok(games.every((game) => game.pgn === pgn));
    assert.equal((await listGameAnalyses(id("ChessGame"), appDb))[0].scoreValue, 21);
    const clock = await pg.query('SELECT "lichessClock"->>\'exact\' AS exact FROM "ChessGame" WHERE id = $1', [id("ChessGame")]);
    assert.equal(clock.rows[0].exact, "9007199254740993");
    const chapter = await appDb.openingChapter.findUniqueOrThrow({ where: { id: id("OpeningChapter") }, include: { lines: true, notes: true } });
    assert.equal(chapter.repertoireId, id("OpeningRepertoire"));
    assert.equal(chapter.lines[0].pgn, pgn);
    assert.equal(chapter.notes[0].chapterId, chapter.id);
    assert.equal((await appDb.openingTrainingReview.findUniqueOrThrow({ where: { id: id("OpeningTrainingReview") }, include: { position: true } })).position.easeFactor, 2.625);
    assert.equal((await appDb.tacticsAttempt.findUniqueOrThrow({ where: { id: id("TacticsAttempt") }, include: { puzzle: true } })).puzzle.id, id("TacticsPuzzle"));
    assert.equal((await appDb.playerProfile.findUniqueOrThrow({ where: { id: id("PlayerProfile") } })).updatedAt.toISOString(), instant);
    assert.equal(await hash(source), before);
  } finally {
    await Promise.all([pg.end(), appDb.$disconnect()]);
    await rm(dir, { recursive: true, force: true });
  }
});
