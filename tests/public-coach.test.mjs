import assert from "node:assert/strict";
import { test } from "node:test";
import { coachGames, coachPriorities, summarizeCoachGames, summarizeCoachTraining } from "../lib/public-coach.ts";
import { decodeProgress, readProgress, recordTacticsAttempt, saveProgress, validatedPgn } from "../lib/public-progress.ts";
import { ENGINE_BUILD, ENGINE_SETTINGS } from "../lib/stockfish/engine.ts";

const now = Date.parse("2026-11-21T00:00:00.000Z");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function progress(overrides = {}) {
  return decodeProgress(JSON.stringify({ version: 1, games: [], solves: {}, recalls: 0, ...overrides }));
}
function makeGame(event, username = "Player") {
  return { kind: "game", name: event, source: "lichess", sourceUsername: username,
    pgn: `[Event "${event}"]\n[White "Player"]\n[Black "Opponent"]\n\n1. a3 a6 2. h3 h6 3. b3 b6 4. g3 g6 5. c3 c6 6. f3 f6 *` };
}
function analysis({ id, game }, depth = 12) {
  const moves = validatedPgn(game.pgn).history({ verbose: true });
  const alternatives = ["e4", "e5", "e4", "e5", "e4", "e5", "e4", "e5", "e4", "e5", "e4", "e5"];
  return [moves[0].before, ...moves.map(({ after }) => after)].map((fen, ply) => ({
    id: JSON.stringify([id, ply, fen, ENGINE_BUILD, ENGINE_SETTINGS, depth]), gameId: id, ply, fen, engine: ENGINE_BUILD,
    settings: ENGINE_SETTINGS, depth, terminal: null, scoreType: "cp", scoreValue: ply % 2 ? -300 : 0,
    bestMove: alternatives[ply] ?? null, variation: JSON.stringify(alternatives[ply] ? [alternatives[ply]] : []),
  }));
}

test("Coach distinguishes empty data from measured performance and ignores legacy solve totals", async () => {
  const empty = progress({ solves: { "00008": 4 } });
  const training = summarizeCoachTraining(empty, now);
  const games = summarizeCoachGames(await coachGames(empty.games), []);
  assert.equal(training.tactics.rate, null);
  assert.equal(training.tactics.recent.rate, null);
  assert.equal(games.assessed, 0);
  assert.deepEqual(coachPriorities(training, games), []);
});

test("Tactics trends use visible samples and opening counts use current repertoire decision nodes", () => {
  const rep = { id: id(1), name: "Branches", color: "white", moves: [
    { id: id(2), parent: "root", from: "e2", to: "e4" }, { id: id(3), parent: "root", from: "d2", to: "d4" },
    { id: id(4), parent: id(2), from: "e7", to: "e5" }, { id: id(5), parent: id(4), from: "g1", to: "f3" },
  ] };
  const reviewedAt = now - 20 * 86_400_000;
  const mastered = { repertoireId: rep.id, nodeId: "root", decisionId: id(80), reviewedAt, intervalMs: 14 * 86_400_000,
    dueAt: reviewedAt + 14 * 86_400_000, firstCorrect: true, incorrect: false, hinted: false, revealed: false, streak: 4, successes: 4, failures: 1 };
  let data = progress({ repertoires: [rep], openingReviews: [mastered, { ...mastered, nodeId: id(99) }] });
  for (let i = 0; i < 20; i++) {
    data = recordTacticsAttempt(data, { id: id(i + 100), puzzleId: "fixture", timestamp: new Date(now - (20 - i) * 1000).toISOString(),
      difficulty: "normal", theme: "mix", solved: true, incorrectMove: i >= 12, skipped: false, rating: null });
  }
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  saveProgress(storage, data);
  const summary = summarizeCoachTraining(readProgress(storage), now);
  assert.deepEqual(summary.tactics.recent, { attempted: 10, clean: 2, rate: 20 });
  assert.equal(summary.tactics.previous.rate, 100);
  assert.equal(summary.tactics.rate, 60);
  assert.deepEqual(summary.opening, { repertoires: 1, due: 1, newPositions: 1, learning: 0, mastered: 1, successes: 4, failures: 1 });
  assert.deepEqual(coachPriorities(summary).map(({ href }) => href), ["/tactics"]);
});

test("only a complete same-depth cohort contributes and only attributable moves inform personal patterns", async () => {
  const owned = makeGame("Owned");
  const unattributed = makeGame("Unknown", "Other");
  const incomplete = makeGame("Partial");
  const games = await coachGames([{ ...owned, sourceUsername: undefined }, owned, unattributed, incomplete]);
  assert.equal(games.length, 3);
  const [a, b, c] = games;
  const summary = summarizeCoachGames(games, [
    ...analysis(a), ...analysis(a, 14).slice(0, 3), ...analysis(b),
    ...analysis(c).slice(0, 6), ...analysis(c, 14).slice(6),
  ]);
  assert.equal(summary.complete, 2);
  assert.equal(summary.unattributed, 1);
  assert.deepEqual(summary.depths, [12]);
  assert.equal(summary.assessed, 6);
  assert.equal(summary.blunders, 6);
  assert.deepEqual(summary.evidence, [{ title: "Owned", issues: 6 }]);
  assert.deepEqual(coachPriorities(summarizeCoachTraining(progress(), now), summary), []);
});

test("repeated serious decisions across two games support a Games recommendation, with correct Black attribution", async () => {
  const games = await coachGames([makeGame("White sample"), makeGame("Black sample", "oPPonent")]);
  const [white, black] = games;
  const summary = summarizeCoachGames(games, [
    ...analysis(white),
    ...analysis(black).map((row) => ({ ...row, scoreValue: row.scoreValue === -300 ? 0 : 300 })),
  ]);
  assert.equal(summary.assessed, 12);
  assert.equal(summary.blunders, 12);
  assert.equal(summary.seriousAffected, 2);
  const training = summarizeCoachTraining(progress(), now);
  const withDue = { ...training, opening: { ...training.opening, due: 3 } };
  assert.deepEqual(coachPriorities(withDue, summary).map(({ href }) => href), ["/openings", "/games"]);
});
