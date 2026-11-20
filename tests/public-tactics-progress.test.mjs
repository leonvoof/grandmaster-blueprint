import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeProgress, maxTacticsAttempts, progressKey, readProgress, recordTacticsAttempt, saveProgress, tacticsFirstTryRate, puzzles } from "../lib/public-progress.ts";

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function attempt(id, overrides = {}) {
  return {
    id, puzzleId: "T9nmF", timestamp: "2026-11-20T12:00:00.000Z", difficulty: "normal", theme: "mix",
    solved: true, incorrectMove: false, skipped: false, rating: 1442, ...overrides,
  };
}

test("real puzzle outcomes update first-try rate and clean streak consistently", () => {
  let progress = readProgress(storage());
  progress = recordTacticsAttempt(progress, attempt("first"));
  assert.deepEqual(progress.tacticsTotals, { attempted: 1, solved: 1, cleanSolved: 1, currentCleanStreak: 1, bestCleanStreak: 1 });

  progress = recordTacticsAttempt(progress, attempt("mistake-then-solve", { incorrectMove: true }));
  assert.deepEqual(progress.tacticsTotals, { attempted: 2, solved: 2, cleanSolved: 1, currentCleanStreak: 0, bestCleanStreak: 1 });

  progress = recordTacticsAttempt(progress, attempt("skip", { solved: false, skipped: true, rating: null }));
  assert.deepEqual(progress.tacticsTotals, { attempted: 3, solved: 2, cleanSolved: 1, currentCleanStreak: 0, bestCleanStreak: 1 });
  assert.equal(tacticsFirstTryRate(progress.tacticsTotals), 33);
  assert.equal(tacticsFirstTryRate({ attempted: 0, cleanSolved: 0 }), null);
  assert.equal(progress.tacticsAttempts[1].incorrectMove, true);
  assert.equal(progress.tacticsAttempts[2].skipped, true);
});

test("attempt IDs make repeated completion events idempotent", () => {
  const start = readProgress(storage());
  const once = recordTacticsAttempt(start, attempt("same-event"));
  const twice = recordTacticsAttempt(once, attempt("same-event", { incorrectMove: true }));
  assert.equal(twice, once);
  assert.equal(twice.tacticsTotals.attempted, 1);
  assert.equal(twice.tacticsAttempts.length, 1);
});

test("live Lichess puzzle IDs can be saved in the existing per-puzzle solve counts", () => {
  const store = storage();
  const result = attempt("lichess-attempt", { puzzleId: "T9nmF" });
  const progress = recordTacticsAttempt(readProgress(store), result);
  saveProgress(store, { ...progress, solves: { ...progress.solves, T9nmF: 1 } });
  assert.equal(readProgress(store).solves.T9nmF, 1);
});

test("tactics history and lifetime totals persist after reload and remain bounded", () => {
  const store = storage();
  let progress = readProgress(store);
  for (let index = 0; index <= maxTacticsAttempts; index++) {
    progress = recordTacticsAttempt(progress, attempt(`attempt-${index}`));
  }
  saveProgress(store, progress);
  const reopened = readProgress(store);
  assert.equal(reopened.tacticsAttempts.length, maxTacticsAttempts);
  assert.equal(reopened.tacticsTotals.attempted, maxTacticsAttempts + 1);
  assert.equal(reopened.tacticsTotals.bestCleanStreak, maxTacticsAttempts + 1);
  assert.equal(reopened.tacticsAttempts.at(-1).puzzleId, "T9nmF");
  assert.equal(JSON.parse(store.getItem(progressKey)).tacticsAttempts.length, maxTacticsAttempts);
  assert.deepEqual(decodeProgress(JSON.stringify(reopened)).tacticsTotals, reopened.tacticsTotals);
});

test("legacy backups preserve old solved counts without inventing attempt history", () => {
  const legacy = { version: 1, games: [], solves: { [puzzles[0].id]: 8 }, recalls: 2 };
  const restored = decodeProgress(JSON.stringify(legacy));
  assert.equal(restored.solves[puzzles[0].id], 8);
  assert.deepEqual(restored.tacticsAttempts, []);
  assert.deepEqual(restored.tacticsTotals, { attempted: 0, solved: 0, cleanSolved: 0, currentCleanStreak: 0, bestCleanStreak: 0 });
});

test("malformed and duplicate persisted tactics entries are rejected", () => {
  const base = { version: 1, games: [], solves: {}, recalls: 0, tacticsAttempts: [attempt("duplicate"), attempt("duplicate")], tacticsTotals: { attempted: 2, solved: 2, cleanSolved: 2, currentCleanStreak: 2, bestCleanStreak: 2 } };
  assert.throws(() => decodeProgress(JSON.stringify(base)), /Duplicate Tactics attempt/);
  assert.throws(() => decodeProgress(JSON.stringify({ ...base, tacticsAttempts: [{ ...attempt("x"), theme: "madeUp" }] })), /Invalid Tactics attempt/);
});
