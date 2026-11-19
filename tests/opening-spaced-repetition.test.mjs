import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { withIsolatedDb } from "./isolated-db.mjs";
import {
  buildReviewablePositions, calculateSchedule, classifyReviewPositions,
  reconcileReviewPositions, resolveLegalUci, saveReviewOutcome, validReviewCounters,
} from "../lib/opening-spaced-repetition.ts";

const day = 86_400_000;
const fixedDate = new Date("2026-11-19T12:00:00.000Z");
const scheduleBase = { repetition: 0, intervalDays: 0, easeFactor: 2.5, recentSuccessHistory: "[]" };
let reviewKey = 0;
const review = (move, overrides = {}) => ({ idempotencyKey: `review-key-${++reviewKey}`, submittedMove: move, incorrectAttempts: 0, hintsUsed: 0, answersRevealed: 0, ...overrides });

test("correct, missed, hinted, and revealed answers receive transparent SM-2 grades and intervals", () => {
  const correct = calculateSchedule(scheduleBase, { ...review("e2e4"), submittedMoveIsExpected: true }, fixedDate);
  assert.equal(correct.grade, 5);
  assert.equal(correct.firstAttemptCorrect, true);
  assert.equal(correct.intervalDays, 1);
  assert.equal(correct.nextReviewAt.getTime(), fixedDate.getTime() + day);

  const retry = calculateSchedule(scheduleBase, { ...review("e2e4", { incorrectAttempts: 1 }), submittedMoveIsExpected: true }, fixedDate);
  assert.equal(retry.grade, 2);
  assert.equal(retry.firstAttemptCorrect, false);
  assert.equal(retry.repetition, 0);
  assert.equal(retry.intervalDays, 1);

  const hinted = calculateSchedule(scheduleBase, { ...review("e2e4", { hintsUsed: 1 }), submittedMoveIsExpected: true }, fixedDate);
  assert.equal(hinted.grade, 3);
  assert.equal(hinted.firstAttemptCorrect, false);
  const revealed = calculateSchedule(scheduleBase, { ...review(null, { answersRevealed: 1 }), submittedMoveIsExpected: false }, fixedDate);
  assert.equal(revealed.grade, 0);
  assert.equal(revealed.repetition, 0);
  assert.equal(validReviewCounters({ incorrectAttempts: 0, hintsUsed: 0, answersRevealed: 1 }), true);
  assert.equal(validReviewCounters({ incorrectAttempts: -1, hintsUsed: 0, answersRevealed: 0 }), false);
  assert.equal(validReviewCounters({ incorrectAttempts: 1.5, hintsUsed: 0, answersRevealed: 0 }), false);
  assert.equal(resolveLegalUci("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "e2e4"), "e2e4");
  assert.equal(resolveLegalUci("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "e2e5"), null);
});

test("successful reviews progress intervals and ease while repeated failures stay short", () => {
  const first = calculateSchedule(scheduleBase, { ...review("e2e4"), submittedMoveIsExpected: true }, fixedDate);
  const second = calculateSchedule(first, { ...review("e2e4"), submittedMoveIsExpected: true }, first.nextReviewAt);
  const third = calculateSchedule(second, { ...review("e2e4"), submittedMoveIsExpected: true }, second.nextReviewAt);
  assert.deepEqual([first.intervalDays, second.intervalDays, third.intervalDays], [1, 6, 17]);
  const failedAgain = calculateSchedule({ ...third, repetition: 0 }, { ...review("d2d4"), submittedMoveIsExpected: false }, third.nextReviewAt);
  assert.equal(failedAgain.intervalDays, 1);
  assert.equal(failedAgain.repetition, 0);
});

test("reviewable positions merge allowed moves but keep color, chapter, start, and path contexts separate", () => {
  const pgns = ["1. e4 e5 2. Nf3 *", "1. d4 d5 2. c4 *", "1. e4 c5 2. Nf3 *"];
  const white = buildReviewablePositions("rep", "chapter", "w", pgns.map((pgn) => ({ pgn })));
  const initial = white.find((position) => position.contextPath.length === 0);
  assert.deepEqual(initial.expectedMoves.sort(), ["d2d4", "e2e4"]);
  const black = buildReviewablePositions("rep", "chapter", "b", pgns.map((pgn) => ({ pgn })));
  const afterE4 = black.find((position) => position.contextPath.join(" ") === "e4");
  assert.deepEqual(afterE4.expectedMoves.sort(), ["c7c5", "e7e5"]);
  assert.notEqual(initial.identity, afterE4.identity);
  assert.notEqual(initial.identity, buildReviewablePositions("rep", "another-chapter", "w", [{ pgn: pgns[0] }])[0].identity);
});

test("custom FEN roots and transposed paths receive distinct contextual identities", () => {
  const customFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 8";
  const custom = `[SetUp "1"]\n[FEN "${customFen}"]\n\n8... c5 9. Nf3 *`;
  const position = buildReviewablePositions("rep", "chapter", "b", [{ pgn: custom }])[0];
  assert.equal(position.startingFen, customFen);
  assert.equal(position.fen, customFen);
  assert.deepEqual(position.expectedMoves, ["c7c5"]);
  const paths = buildReviewablePositions("rep", "chapter", "w", [{ pgn: "1. Nf3 d5 2. d4 *" }, { pgn: "1. d4 d5 2. Nf3 *" }]);
  const reachedSamePosition = paths.filter((entry) => entry.contextPath.length === 2);
  assert.equal(reachedSamePosition.length, 2);
  assert.notEqual(reachedSamePosition[0].identity, reachedSamePosition[1].identity);
});

test("due selection separates new, overdue, due today, mastered, forgotten, and stale positions", () => {
  const base = { applicable: true, recentSuccessHistory: "[]", intervalDays: 0 };
  const start = new Date("2026-11-19T00:00:00.000Z");
  const positions = [
    { ...base, identity: "new", lastReviewAt: null, nextReviewAt: null },
    { ...base, identity: "overdue", lastReviewAt: start, nextReviewAt: new Date(start.getTime() - 1) },
    { ...base, identity: "today", lastReviewAt: start, nextReviewAt: new Date(start.getTime() + 12 * 60 * 60 * 1000) },
    { ...base, identity: "mastered", intervalDays: 30, lastReviewAt: start, nextReviewAt: new Date(start.getTime() + 3 * day) },
    { ...base, identity: "forgotten", lastReviewAt: start, nextReviewAt: new Date(start.getTime() + 2 * day), recentSuccessHistory: "[0,2]" },
    { ...base, identity: "stale", applicable: false, lastReviewAt: null, nextReviewAt: null },
  ];
  const result = classifyReviewPositions(positions, new Date("2026-11-19T06:00:00.000Z"));
  assert.deepEqual(result.newPositions.map(({ identity }) => identity), ["new"]);
  assert.deepEqual(result.overdue.map(({ identity }) => identity), ["overdue"]);
  assert.deepEqual(result.dueToday.map(({ identity }) => identity), ["today"]);
  assert.deepEqual(result.recentlyMastered.map(({ identity }) => identity), ["mastered"]);
  assert.deepEqual(result.repeatedlyForgotten.map(({ identity }) => identity), ["forgotten"]);
  assert.equal(result.stats.applicable, 5);
  assert.equal(result.stats.due, 2);
});

test("saving is idempotent, survives reconnect, and keeps edited-out positions as stale history", () => withIsolatedDb(async (db, file) => {
  const repertoire = await db.openingRepertoire.create({ data: { name: "SRS test", side: "White" } });
  const chapter = await db.openingChapter.create({ data: { repertoireId: repertoire.id, name: "Caro test", category: "custom" } });
  const line = await db.openingLine.create({ data: { chapterId: chapter.id, name: "Line", pgn: "1. e4 e5 2. Nf3 *" } });
  const position = buildReviewablePositions(repertoire.id, chapter.id, "w", [line])[0];
  await reconcileReviewPositions(db, chapter.id, "w", [position, position]);
  await reconcileReviewPositions(db, chapter.id, "w", [position]);
  assert.equal(await db.openingTrainingPosition.count({ where: { identity: position.identity } }), 1);
  const outcome = { idempotencyKey: "opening-test-review-0001", submittedMove: "e2e4", incorrectAttempts: 0, hintsUsed: 0, answersRevealed: 0 };
  const saved = await saveReviewOutcome(db, position, outcome, fixedDate);
  assert.equal(saved.review.firstAttemptCorrect, true);
  assert.equal(await db.openingTrainingReview.count({ where: { positionId: saved.position.id } }), 1);
  await assert.rejects(saveReviewOutcome(db, position, outcome, new Date(fixedDate.getTime() + day)));
  assert.equal(await db.openingTrainingReview.count({ where: { positionId: saved.position.id } }), 1);

  await db.openingLine.delete({ where: { id: line.id } });
  await reconcileReviewPositions(db, chapter.id, "w", []);
  const reopenedDb = new PrismaClient({ datasourceUrl: `file:${file}` });
  try {
    const reopened = await reopenedDb.openingTrainingPosition.findUnique({ where: { identity: position.identity }, include: { reviews: true } });
    assert.equal(reopened.applicable, false);
    assert.equal(reopened.reviews.length, 1);
    assert.equal(reopened.reviews[0].submittedMove, "e2e4");
    assert.equal(reopened.nextReviewAt.toISOString(), new Date(fixedDate.getTime() + day).toISOString());
  } finally { await reopenedDb.$disconnect(); }
}));
