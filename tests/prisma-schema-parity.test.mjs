import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("SQLite and PostgreSQL Prisma schemas keep the same application models and constraints", async () => {
  const load = (path) => readFile(new URL(path, import.meta.url), "utf8");
  const [sqlite, postgres] = await Promise.all([load("../prisma/schema.prisma"), load("../prisma/postgresql/schema.prisma")]);
  const models = (schema) => schema.slice(schema.indexOf("model ")).replace(/, map: "opening_training_position_(applicable|due)_idx"/g, "");
  assert.equal(models(postgres), models(sqlite));
});
