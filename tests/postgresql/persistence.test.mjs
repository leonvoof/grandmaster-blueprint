import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_POSITION } from "chess.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

test("PostgreSQL persists synthetic games, analysis, repertoire training, and puzzle attempts", async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Use a disposable local PostgreSQL database.");
  const db = new PrismaClient();
  for (const model of ["playerProfile", "chessGame", "openingRepertoire", "tacticsPuzzle"]) {
    assert.equal(await db[model].count(), 0, "Use a freshly migrated database.");
  }
  const { savePgnGames, listSavedGames } = await import("../../lib/games.ts");
  const { prisma } = await import("../../lib/prisma.ts");
  try {
    const { parsePgnCollection } = await import("../../lib/pgn.ts");
    const { savePositionAnalysis } = await import("../../lib/game-analysis.ts");
    const { importOpeningPgn } = await import("../../lib/opening-import.ts");
    const { buildReviewablePositions, reconcileReviewPositions, saveReviewOutcome } = await import("../../lib/opening-spaced-repetition.ts");
    const { parsePuzzleRow } = await import("../../lib/tactics.ts");

    const pgn = '[Event "Synthetic fixture"]\n[White "Fixture White"]\n[Black "Fixture Black"]\n[Result "*"]\n\n1. e4 {center} e5 2. Nf3 *';
    const rows = parsePgnCollection(pgn);
    await savePgnGames(rows);
    await savePgnGames(rows);
    const games = await listSavedGames();
    assert.equal(games.length, 1);
    const [game] = games;
    await assert.rejects(db.chessGame.create({ data: rows[0] }), { code: "P2002" });
    const clocks = [{ ply: 1, seconds: 299 }];
    await db.chessGame.update({ where: { id: game.id }, data: { lichessClock: clocks } });
    assert.deepEqual((await listSavedGames())[0].lichessClock, clocks);
    const fen = game.initialFen ?? DEFAULT_POSITION;
    const analysis = await savePositionAnalysis(game.id, {
      fen, ply: 0, engine: "Synthetic test engine", settings: "test", depth: 12,
      score: { kind: "cp", value: 21 }, bestMove: "e4", variation: ["e4", "e5"],
    }, db);
    await db.reviewEvent.create({ data: { gameAnalysisId: analysis.id, kind: "reveal" } });
    await db.mistakeReflection.create({ data: { gameAnalysisId: analysis.id, learned: "Fixture note" } });
    const saved = await db.gameAnalysis.findUniqueOrThrow({ where: { id: analysis.id }, include: { reflection: true, reviewEvents: true } });
    assert.equal(saved.scoreValue, 21);
    assert.equal(saved.reflection.learned, "Fixture note");
    assert.equal(saved.reviewEvents.length, 1);

    const repertoire = await db.openingRepertoire.create({ data: { name: "Fixture repertoire", side: "White" } });
    assert.equal((await importOpeningPgn(repertoire.id, pgn, db)).linesCreated, 1);
    assert.equal((await importOpeningPgn(repertoire.id, pgn, db)).duplicates, 1);
    const chapter = await db.openingChapter.findFirstOrThrow({ where: { repertoireId: repertoire.id }, include: { lines: true, notes: true } });
    assert.ok(chapter.notes.some((note) => note.text === "center"));
    const [position] = buildReviewablePositions(repertoire.id, chapter.id, "w", chapter.lines);
    await reconcileReviewPositions(db, chapter.id, "w", [position]);
    const reviewed = await saveReviewOutcome(db, position, {
      idempotencyKey: "fixture-review", submittedMove: "e2e4", incorrectAttempts: 0, hintsUsed: 0, answersRevealed: 0,
    }, new Date("2026-11-19T12:00:00Z"));
    assert.equal(reviewed.review.firstAttemptCorrect, true);
    assert.equal(reviewed.position.nextReviewAt.toISOString(), "2026-11-20T12:00:00.000Z");

    const puzzle = await db.tacticsPuzzle.create({ data: parsePuzzleRow({ id: "fixture", fen, moves: "e2e4 e7e5", rating: 1500, themes: "fixture" }) });
    const attempt = { puzzleId: puzzle.id, idempotencyKey: "fixture-attempt", submittedMoves: '["e7e5"]', firstAttemptCorrect: true, solvingTimeMs: 2000, completed: true };
    await db.tacticsAttempt.create({ data: attempt });
    await assert.rejects(db.tacticsAttempt.create({ data: attempt }), { code: "P2002" });
    await assert.rejects(db.tacticsAttempt.create({ data: { ...attempt, idempotencyKey: "orphan", puzzleId: "missing" } }), { code: "P2003" });
    assert.equal(await db.tacticsAttempt.count({ where: { puzzleId: puzzle.id } }), 1);
  } finally {
    await Promise.all([db.$disconnect(), prisma.$disconnect()]);
  }
});
