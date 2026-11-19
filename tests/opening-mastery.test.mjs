import assert from "node:assert/strict";
import { test } from "node:test";
import { filterMasterySnapshot, pendingReviewSaveCounts, summarizeMastery, summarizeRepertoireProgress } from "../lib/opening-mastery.ts";

const pos = (identity, chapterId, options = {}) => ({ identity, repertoireId: "rep", chapterId, fen: "fen", contextPath: [], applicable: true, nextReviewAt: null, intervalDays: 0, repetition: 0, ...options });
const review = (id, identity, chapterId, reviewedAt, firstAttemptCorrect, options = {}) => ({ id, positionId: identity, firstAttemptCorrect, incorrectAttempts: firstAttemptCorrect ? 0 : 1, hintsUsed: 0, answersRevealed: 0, grade: firstAttemptCorrect ? 5 : 0, reviewedAt, position: { identity, chapterId, fen: "fen", contextPath: "[]", expectedMoves: "[]", trainingColor: "w", nextReviewAt: null, intervalDays: 0, repetition: 0 }, ...options });
const snapshot = {
  repertoireId: "rep", trainingColor: "w",
  positions: [pos("new", "a"), pos("due", "a", { nextReviewAt: "2026-11-19T12:00:00Z", repetition: 1 }), pos("mastered", "b", { intervalDays: 30, nextReviewAt: "2026-12-01T00:00:00Z", repetition: 3 }), pos("forgotten", "b", { intervalDays: 1 }), pos("stale", "b", { applicable: false })],
  newPositions: [pos("new", "a")], overdue: [pos("over", "a", { nextReviewAt: "2026-11-18T00:00:00Z" })],
  dueToday: [pos("due", "a", { nextReviewAt: "2026-11-19T12:00:00Z" })],
  due: [pos("over", "a", { nextReviewAt: "2026-11-18T00:00:00Z" }), pos("due", "a", { nextReviewAt: "2026-11-19T12:00:00Z" })],
  recentlyMastered: [pos("mastered", "b", { intervalDays: 30, nextReviewAt: "2026-12-01T00:00:00Z", repetition: 3 })],
  repeatedlyForgotten: [pos("forgotten", "b", { intervalDays: 1 })],
  stats: { applicable: 3, new: 1, due: 2, overdue: 1, recentlyMastered: 1, repeatedlyForgotten: 1 },
  chapters: [{ chapterId: "a", chapterName: "A", applicable: 2, new: 1, due: 2, overdue: 1, recentlyMastered: 0, repeatedlyForgotten: 0 }, { chapterId: "b", chapterName: "B", applicable: 1, new: 0, due: 0, overdue: 0, recentlyMastered: 1, repeatedlyForgotten: 1 }],
  reviewHistory: [review("r1", "due", "a", "2026-11-18T10:00:00Z", true), review("r2", "forgotten", "b", "2026-11-19T10:00:00Z", false), review("stale-review", "stale", "b", "2026-11-19T11:00:00Z", true)],
};

test("mastery summary uses persisted events, excludes stale identities, and keeps due categories disjoint", () => {
  const result = summarizeMastery(snapshot);
  assert.equal(result.total, 4);
  assert.equal(result.due, 2);
  assert.equal(result.dueToday, 1);
  assert.equal(result.overdue, 1);
  assert.equal(result.newPositions, 1);
  assert.equal(result.recentlyMastered, 1);
  assert.equal(result.repeatedlyForgotten, 1);
  assert.equal(result.lifetimeAccuracy, 0.5);
  assert.equal(result.lifetimeReviews, 2);
  assert.equal(result.activity.length, 2);
  assert.equal(result.difficult[0].reviews.length, 1);
});

test("chapter filter scopes positions, due workload, histories, and accuracy", () => {
  const scoped = summarizeMastery(filterMasterySnapshot(snapshot, "a"));
  assert.equal(scoped.total, 2);
  assert.equal(scoped.due, 2);
  assert.equal(scoped.repeatedlyForgotten, 0);
  assert.equal(scoped.lifetimeAccuracy, 1);
  assert.equal(scoped.lifetimeReviews, 1);
});

test("empty history has explicit unavailable accuracy and repertoire progress is not fabricated", () => {
  const empty = { ...snapshot, positions: [], newPositions: [], overdue: [], dueToday: [], due: [], recentlyMastered: [], repeatedlyForgotten: [], reviewHistory: [], chapters: [] };
  const result = summarizeMastery(empty);
  assert.equal(result.total, 0);
  assert.equal(result.lifetimeAccuracy, null);
  assert.equal(result.recentAccuracy, null);
  const progress = summarizeRepertoireProgress([{ id: "rep", name: "Test", side: "White", chapters: [] }], [empty]);
  assert.equal(progress[0].progress, null);
  assert.equal(progress[0].accuracy, null);
});

test("pending and failed local saves are countable separately from persisted mastery data", () => {
  assert.deepEqual(pendingReviewSaveCounts([{ status: "queued" }, { status: "error" }, { status: "error" }]), { pending: 3, failed: 2 });
  assert.deepEqual(pendingReviewSaveCounts(null), { pending: 0, failed: 0 });
});
