import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { beginExercise, playOpponent, requestHint, revealAnswer, submitTrainingMove } from "../lib/opening-trainer.ts";
import { publicPracticeOutcome, publicPracticeRoot } from "../lib/public-opening-practice.ts";
import { openingMastery, recordOpeningReview } from "../lib/public-opening-reviews.ts";
import { decodeProgress, readProgress, saveProgress } from "../lib/public-progress.ts";
import { mergeRepertoireLines } from "../lib/public-repertoire.ts";

const day = 86_400_000;
const now = Date.UTC(2026, 0, 1);
const move = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2) });
const fixture = (color = "white") => mergeRepertoireLines(
  { id: randomUUID(), name: "Fixture", color, moves: [] },
  [["e2e4", "e7e5", "g1f3"], ["e2e4", "e7e5", "f1c4"], ["e2e4", "c7c5"]], randomUUID);
const complete = (rep, state, uci) => {
  assert.equal(submitTrainingMove(state, move(uci)).accepted, true);
  return publicPracticeOutcome(rep.id, state, randomUUID(), now);
};

test("unaided recall progresses to mastery and becomes due at the scheduled time", () => {
  const rep = fixture();
  const state = beginExercise(publicPracticeRoot(rep), "w");
  const result = complete(rep, state, "e2e4");
  assert.equal(result.firstCorrect, true);
  assert.deepEqual(openingMastery(rep, [], now), { newPositions: 2, due: 0, learning: 0, mastered: 0 });
  let reviews = [];
  [1, 3, 7, 14, 21, 30, 45, 60, 90, 90].forEach((days, index) => {
    const outcome = { ...result, reviewedAt: now + index, decisionId: randomUUID() };
    reviews = recordOpeningReview(reviews, outcome);
    assert.equal(recordOpeningReview(reviews, outcome), reviews);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].intervalMs, days * day);
    assert.equal(reviews[0].successes, index + 1);
  });
  const due = reviews[0].dueAt;
  assert.deepEqual(openingMastery(rep, reviews, due - 1), { newPositions: 1, due: 0, learning: 0, mastered: 1 });
  assert.equal(openingMastery(rep, reviews, due).due, 1);
});

test("wrong moves, hints, and reveals schedule earlier and reset mastery progress", () => {
  const rep = fixture();
  const state = beginExercise(publicPracticeRoot(rep), "w");
  const wrong = submitTrainingMove(state, move("d2d4"));
  assert.equal(wrong.accepted, false);
  const clean = complete(rep, state, "e2e4");
  const baseline = recordOpeningReview([], { ...clean, reviewedAt: now - 1 });
  for (const [result, intervalMs, flag] of [
    [complete(rep, wrong.state, "e2e4"), 600_000, "incorrect"],
    [complete(rep, requestHint(state), "e2e4"), day / 2, "hinted"],
    [publicPracticeOutcome(rep.id, revealAnswer(state), randomUUID(), now), 600_000, "revealed"],
  ]) {
    assert.equal(result[flag], true);
    assert.equal(result.firstCorrect, false);
    const [review] = recordOpeningReview(baseline, result);
    assert.equal(review.intervalMs, intervalMs);
    assert.equal(review.streak, 0);
    assert.equal(review.successes, 1);
    assert.equal(review.failures, 1);
  }
});

test("White alternatives share a review node and Black opponents produce no review", () => {
  const white = fixture();
  const root = beginExercise(publicPracticeRoot(white), "w");
  const turn = playOpponent(submitTrainingMove(root, move("e2e4")).state, () => 0);
  assert.equal(complete(white, turn, "g1f3").nodeId, complete(white, turn, "f1c4").nodeId);
  const black = fixture("black");
  const initial = beginExercise(publicPracticeRoot(black), "b");
  assert.equal(publicPracticeOutcome(black.id, initial, randomUUID(), now), null);
  const blackTurn = playOpponent(initial, () => 0);
  assert.equal(complete(black, blackTurn, "e7e5").nodeId, black.moves[0].id);
  assert.equal(complete(black, blackTurn, "c7c5").firstCorrect, true);
});

test("browser progress round-trips reviews and prunes deleted positions and repertoires", () => {
  const rep = fixture();
  const oldBackup = decodeProgress(JSON.stringify({ version: 1, games: [], solves: {}, recalls: 3, repertoires: [rep] }));
  assert.deepEqual(oldBackup.openingReviews, []);
  const storage = new Map();
  const access = { getItem: (key) => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val) };
  const root = beginExercise(publicPracticeRoot(rep), "w");
  const turn = playOpponent(submitTrainingMove(root, move("e2e4")).state, () => 0);
  const reviews = recordOpeningReview(recordOpeningReview([], complete(rep, root, "e2e4")), complete(rep, turn, "g1f3"));
  saveProgress(access, { ...oldBackup, repertoires: [{ ...rep, name: "Renamed" }], openingReviews: reviews });
  assert.deepEqual(readProgress(access).openingReviews, reviews);
  saveProgress(access, { ...readProgress(access), repertoires: [{ ...rep, moves: rep.moves.slice(0, 1) }] });
  assert.deepEqual(readProgress(access).openingReviews, reviews.slice(0, 1));
  saveProgress(access, { ...readProgress(access), repertoires: [] });
  assert.deepEqual(readProgress(access).openingReviews, []);
});
