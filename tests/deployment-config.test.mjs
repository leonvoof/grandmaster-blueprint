import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Vercel always builds the PostgreSQL client and build hooks never migrate data", async () => {
  const vercel = JSON.parse(await source("vercel.json"));
  const { scripts } = JSON.parse(await source("package.json"));
  assert.equal(vercel.buildCommand, "GMB_DB_PROVIDER=postgresql npm run build");
  assert.match(scripts.prebuild, /generate-prisma/);
  assert.doesNotMatch(`${scripts.prebuild} ${scripts.build}`, /migrate deploy|db:push|db:transfer/);
  assert.doesNotMatch(scripts.start, /migrate deploy|db:push|db:transfer/);
});

test("local credentials, databases, backups, and Vercel metadata are ignored", async () => {
  const ignore = await source(".gitignore");
  for (const pattern of [".env*", "!.env.example", "prisma/*.db", "prisma/*.db.backup-*", ".vercel/"]) {
    assert.ok(ignore.split(/\r?\n/).includes(pattern), `missing ignore rule ${pattern}`);
  }
});

test("Lichess sync is a bounded Node.js function that can resume after timeout", async () => {
  const route = await source("app/api/lichess/route.ts");
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /export const maxDuration = 60/);
  assert.match(route, /syncLichessGames\(/);
});
