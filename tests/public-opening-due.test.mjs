import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Chess } from "chess.js";
import { beginExercise, requestHint, revealAnswer, submitTrainingMove } from "../lib/opening-trainer.ts";
import { publicPracticeOutcome, publicPracticePosition } from "../lib/public-opening-practice.ts";
import { dueOpeningReviews, recordOpeningReview } from "../lib/public-opening-reviews.ts";
import { decodeProgress } from "../lib/public-progress.ts";
import { mergeRepertoireLines, repertoireRoot } from "../lib/public-repertoire.ts";

const now = Date.UTC(2026, 0, 5);
const old = now - 2 * 86_400_000;
const move = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
const build = (color, ...lines) => mergeRepertoireLines({ id: randomUUID(), name: "Fixture", color, moves: [] }, lines, randomUUID);
const white = build("white", ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"], ["e2e4", "a7a6", "e4e5", "d7d5", "g1f3"]);
const black = build("black", ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "g8f6", "e1g1", "f8e7", "d2d3", "e8g8"]);
const whiteNode = white.moves[3].id;
const blackNode = black.moves.at(-2).id;
const start = (rep, node) => beginExercise(publicPracticePosition(rep, node), rep.color === "white" ? "w" : "b");
const review = (rep, node, time = old, state = start(rep, node)) =>
  recordOpeningReview([], publicPracticeOutcome(rep.id, state, randomUUID(), time))[0];

test("queue orders earlier due dates first, breaks ties by recall history, and filters future, unseen, stale and duplicate decisions", () => {
  const earliest = review(white, repertoireRoot, old - 1);
  const weak = { ...review(black, blackNode), successes: 1, failures: 4 };
  const strong = review(white, whiteNode);
  const future = review(black, black.moves[0].id, now);
  const stale = { ...earliest, nodeId: randomUUID() };
  assert.deepEqual(dueOpeningReviews([white, black], [strong, earliest, future, stale, weak, strong], now), [earliest, weak, strong]);
  assert.deepEqual(dueOpeningReviews([white], [strong], old), []);
  assert.deepEqual(dueOpeningReviews([white], [], now), []);
  assert.deepEqual(dueOpeningReviews([{ ...white, moves: white.moves.slice(0, 4) }], [strong, earliest], now), [earliest]);
});

test("starts the exact White and Black decision with all saved moves, en passant, and castling intact", () => {
  const ep = start(white, whiteNode);
  assert.equal(ep.status, "player");
  assert.equal(new Chess(ep.position.fen).get("d5")?.type, "p");
  assert.equal(ep.position.fen.split(" ")[3], "d6");
  for (const uci of ["e5d6", "g1f3"]) assert.equal(submitTrainingMove(ep, move(uci)).accepted, true);
  const castle = start(black, blackNode);
  assert.equal(castle.status, "player");
  const result = submitTrainingMove(castle, move("e8g8"));
  assert.equal(result.accepted, true);
  assert.equal(new Chess(result.state.position.fen).get("f8")?.type, "r");
  assert.equal(publicPracticePosition(white, randomUUID()), null);
});

test("retry keeps the mistake, hints and reveals use the existing schedule, and only saved decisions survive exit and refresh", () => {
  const wrong = submitTrainingMove(start(white, whiteNode), move("d2d4"));
  assert.equal(wrong.accepted, false);
  const initial = [review(white, whiteNode), review(black, blackNode)];
  const queue = dueOpeningReviews([white, black], initial, now);
  assert.deepEqual(dueOpeningReviews([white, black], initial, now), queue); // Leaving before completion writes nothing.

  const hinted = requestHint(wrong.state);
  assert.equal(submitTrainingMove(hinted, move("g1f3")).accepted, true);
  const outcome = publicPracticeOutcome(white.id, hinted, randomUUID(), now);
  assert.equal(outcome.incorrect, true);
  assert.equal(outcome.hinted, true);
  assert.equal(outcome.firstCorrect, false);
  const saved = recordOpeningReview(initial, outcome);
  assert.equal(recordOpeningReview(saved, outcome), saved);
  const refreshed = decodeProgress(JSON.stringify({ version: 1, games: [], solves: {}, recalls: 0, repertoires: [white, black], openingReviews: saved }));
  assert.deepEqual(dueOpeningReviews(refreshed.repertoires, refreshed.openingReviews, now), [initial[1]]);
  assert.equal(saved.find(({ nodeId }) => nodeId === whiteNode).dueAt, now + 600_000);
  const revealed = publicPracticeOutcome(black.id, revealAnswer(start(black, blackNode)), randomUUID(), now);
  assert.equal(revealed.revealed, true);
  assert.equal(recordOpeningReview(saved, revealed).find(({ nodeId }) => nodeId === blackNode).dueAt, now + 600_000);
});
