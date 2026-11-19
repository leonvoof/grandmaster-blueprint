import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier.startsWith("@/") ? nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context) : nextResolve(specifier, context);
} });
const { savePositionAnalysis, listGameAnalyses } = await import("../lib/game-analysis.ts");
const { parsePgnCollection } = await import("../lib/pgn.ts");

test("position analysis persistence validates, retrieves, and updates exact duplicates without replacing deeper analysis", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blueprint-analysis-"));
  const file = join(directory, "analysis.db");
  const sqlite = new DatabaseSync(file);
  for (const migration of ["202611180001_baseline", "202611180002_game_fingerprint", "202611180003_lichess_sync", "202611190001_game_analysis"]) {
    sqlite.exec(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8"));
  }
  sqlite.close();
  const db = new PrismaClient({ datasourceUrl: `file:${file}` });
  try {
    const [parsed] = parsePgnCollection('[Event "Test"]\n[White "White"]\n[Black "Black"]\n[Result "*"]\n\n1. e4 e5 *');
    const game = await db.chessGame.create({ data: parsed });
    const input = { fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", ply: 0, engine: "Stockfish-test", settings: "threads=1;multiPV=1", depth: 12, score: { kind: "cp", value: 21 }, bestMove: "e4", variation: ["e4", "e5"] };
    const saved = await savePositionAnalysis(game.id, input, db);
    await savePositionAnalysis(game.id, { ...input, score: { kind: "cp", value: 30 } }, db);
    await savePositionAnalysis(game.id, { ...input, depth: 15, score: { kind: "cp", value: 25 } }, db);
    const results = await listGameAnalyses(game.id, db);
    assert.equal(results.length, 2);
    assert.equal(results.find((result) => result.id === saved.id).scoreValue, 30);
    assert.equal(results.find((result) => result.depth === 15).scoreValue, 25);
    assert.deepEqual(JSON.parse(results[0].variation), ["e4", "e5"]);
    for (const invalid of [{ ...input, fen: "invalid" }, { ...input, fen: "7k/6Q1/6K1/8/8/8/8/8 w - - 0 1" }, { ...input, variation: ["e4", "e4"] }, { ...input, ply: -1 }, { ...input, depth: 0 }]) {
      await assert.rejects(savePositionAnalysis(game.id, invalid, db));
    }
    await assert.rejects(savePositionAnalysis("missing-game", input, db), /Foreign key constraint/);
  } finally {
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
