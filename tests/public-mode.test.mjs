import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { resolveSiteMode, publicPages, publicRequestAllowed, privateRouteDisabled } from "../lib/site-mode.ts";
import { decodeProgress, readProgress, saveProgress, puzzles, progressKey, maxBackupBytes } from "../lib/public-progress.ts";
import { parsePuzzleRow } from "../lib/tactics.ts";
import { buildTrainingTree, startExercise, playAnswer } from "../lib/opening-trainer.ts";

test("hosted previews can run publicly or stay blocked, never use private mode", () => {
  assert.equal(resolveSiteMode(), "private");
  assert.equal(resolveSiteMode("private", "production"), "private");
  assert.equal(resolveSiteMode(undefined, "production"), "blocked");
  assert.equal(resolveSiteMode("typo", "production"), "blocked");
  assert.equal(resolveSiteMode("private", "preview"), "blocked");
  assert.equal(resolveSiteMode(undefined, "preview"), "blocked");
  assert.equal(resolveSiteMode("public", "preview"), "public");
});

test("public allowlist permits the pages and worker, never private APIs or writes", async () => {
  for (const path of publicPages) {
    assert.equal(publicRequestAllowed(path, "GET"), true, path);
    assert.equal(publicRequestAllowed(path, "POST"), false, path);
  }
  assert.equal(publicRequestAllowed("/stockfish/19.0.1/stockfish-19-lite-single.wasm", "GET"), true);
  assert.equal(publicRequestAllowed("/stockfish/19.0.1/private.json", "GET"), false);
  assert.equal(publicRequestAllowed("/login", "GET"), false);
  const dir = new URL("../app/api/", import.meta.url);
  const routes = (await readdir(dir, { recursive: true })).filter((file) => file.endsWith("route.ts"));
  assert.ok(routes.length >= 16);
  for (const file of routes) {
    const path = "/api/" + file.replace(/\/route\.ts$/, "").replace(/\[[^\]]+\]/g, "id");
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      assert.equal(publicRequestAllowed(path, method), false, method + " " + path);
    }
    assert.match(await readFile(new URL(file, dir), "utf8"), /privateRouteDisabled\(\)/, path);
  }
  assert.equal(publicRequestAllowed("/api/future", "GET"), false);
});

test("public route guard blocks without a session and is independent of authentication", () => {
  const previous = process.env.GMB_SITE_MODE;
  try {
    process.env.GMB_SITE_MODE = "public";
    assert.equal(privateRouteDisabled()?.status, 404);
  } finally {
    if (previous === undefined) delete process.env.GMB_SITE_MODE;
    else process.env.GMB_SITE_MODE = previous;
  }
});

function browserStorage() {
  const entries = new Map();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, data) => entries.set(key, data) };
}

test("browser reload recovers progress and JSON backup can be restored in another profile", () => {
  const first = browserStorage();
  const second = browserStorage();
  const game = { kind: "opening", name: "Test line", pgn: "1. e4 e5 2. Nf3 *" };
  const snapshot = { version: 1, games: [game], solves: { [puzzles[0].id]: 2 }, recalls: 1 };
  saveProgress(first, snapshot);
  const normalized = { ...snapshot, repertoires: [], openingReviews: [], tacticsAttempts: [], tacticsTotals: { attempted: 0, solved: 0, cleanSolved: 0, currentCleanStreak: 0, bestCleanStreak: 0 } };
  assert.deepEqual(readProgress(first), normalized);
  assert.equal(readProgress(second).recalls, 0);
  assert.deepEqual(saveProgress(second, decodeProgress(first.getItem(progressKey))), normalized);
  assert.throws(() => saveProgress(first, { ...snapshot, games: [{ ...game, pgn: "1. e5 *" }] }));
  assert.throws(() => saveProgress(first, { ...snapshot, solves: { "bad puzzle id": 1 } }));
  assert.throws(() => decodeProgress(" ".repeat(maxBackupBytes + 1)));
  assert.deepEqual(readProgress(first), normalized);
});

test("every bundled Lichess puzzle has a legal setup and solution", () => {
  for (const row of puzzles) {
    const puzzle = parsePuzzleRow(row);
    assert.ok(puzzle.fen);
    assert.ok(puzzle.moveCount > 0);
  }
});

test("browser opening recall plays the saved reply and completes a supplied line", () => {
  const { roots } = buildTrainingTree([{ pgn: "1. e4 e5 2. Nf3 *" }]);
  const random = () => 0;
  let exercise = startExercise(roots[0], "w", random);
  exercise = playAnswer(exercise, { from: "e2", to: "e4" }, random).state;
  assert.deepEqual(exercise.moves, ["e4", "e5"]);
  exercise = playAnswer(exercise, { from: "g1", to: "f3" }, random).state;
  assert.equal(exercise.status, "complete");
});
