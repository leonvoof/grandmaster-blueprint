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
const { savePositionAnalysis } = await import("../lib/game-analysis.ts");
const { listMistakeReviews, saveMistakeReviewEvent } = await import("../lib/mistake-review.ts");
const { preMovePly } = await import("../lib/mistake-review-utils.ts");
const { parsePgnCollection } = await import("../lib/pgn.ts");

test("mistake review validates moves, persists reflections and history, and scopes records to the saved game", async () => {
  assert.equal(preMovePly(1), 0);
  assert.equal(preMovePly(8), 7);
  const directory = await mkdtemp(join(tmpdir(), "blueprint-review-"));
  const file = join(directory, "review.db");
  const sqlite = new DatabaseSync(file);
  for (const migration of ["202611180001_baseline", "202611180002_game_fingerprint", "202611180003_lichess_sync", "202611190001_game_analysis", "202611190002_mistake_review"]) {
    sqlite.exec(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8"));
  }
  sqlite.close();
  const db = new PrismaClient({ datasourceUrl: `file:${file}` });
  try {
    const [parsed] = parsePgnCollection('[Event "Review"]\n[White "White"]\n[Black "Black"]\n[Result "*"]\n\n1. e4 e5 *');
    const game = await db.chessGame.create({ data: parsed });
    const analysis = await savePositionAnalysis(game.id, {
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", ply: 0,
      engine: "Stockfish-test", settings: "threads=1", depth: 12,
      score: { kind: "cp", value: 30 }, bestMove: "e4", variation: ["e4", "e5"],
    }, db);
    const reflection = { thinking: "", overlooked: "candidate threat", variations: "1. d4 d5", learned: "", recognition: "check forcing moves" };
    await saveMistakeReviewEvent(game.id, { action: "save-reflection", analysisId: analysis.id, reflection }, db);
    const first = await saveMistakeReviewEvent(game.id, { action: "submit", analysisId: analysis.id, move: "e4" }, db);
    assert.equal(first.event.matchedBest, true);
    assert.equal(first.firstAttempt, true);
    const second = await saveMistakeReviewEvent(game.id, { action: "submit", analysisId: analysis.id, move: "d4" }, db);
    assert.equal(second.event.matchedBest, false);
    assert.equal(second.firstAttempt, false);
    await saveMistakeReviewEvent(game.id, { action: "hint", analysisId: analysis.id }, db);
    await saveMistakeReviewEvent(game.id, { action: "reveal", analysisId: analysis.id }, db);
    await assert.rejects(saveMistakeReviewEvent(game.id, { action: "submit", analysisId: analysis.id, move: "e5" }, db), /not legal/);
    await assert.rejects(saveMistakeReviewEvent("other-game", { action: "reveal", analysisId: analysis.id }, db), /does not belong/);
    const [review] = await listMistakeReviews(game.id, db);
    assert.deepEqual(review.reflection, reflection);
    assert.deepEqual(review.events.map((event) => event.kind), ["submit", "submit", "hint", "reveal"]);
    assert.equal(review.events.filter((event) => event.kind === "submit" && event.matchedBest).length, 1);
    assert.equal(review.events.filter((event) => event.kind === "reveal").length, 1);
    await db.$disconnect();
    const reopened = new PrismaClient({ datasourceUrl: `file:${file}` });
    const [afterRestart] = await listMistakeReviews(game.id, reopened);
    assert.deepEqual(afterRestart.reflection, reflection);
    assert.equal(afterRestart.events.length, 4);
    await reopened.$disconnect();
  } finally {
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
