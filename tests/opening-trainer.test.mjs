import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import {
  buildTrainingTree, endExercise, playAnswer, playOpponent,
  requestHint, revealAnswer, selectRoot, startExercise, startExerciseAt, trainingPositionAt,
} from "../lib/opening-trainer.ts";

const first = () => 0;
const last = () => 0.999;
const lines = (...games) => games.map((pgn) => Object.freeze({ pgn }));
const root = (...games) => buildTrainingTree(lines(...games)).roots[0];
const answer = (state, from, to, random = first, promotion) => playAnswer(state, { from, to, promotion }, random);

test("White starts at the standard position and can choose either saved answer", () => {
  const tree = root("1. e4 e5 2. Nf3 *", "1. d4 d5 2. c4 *");
  const initial = startExercise(tree, "w", first);
  assert.equal(initial.status, "player");
  assert.equal(initial.position.fen, new Chess().fen());
  assert.equal(initial.position.continuations.size, 2);
  const kingPawn = answer(initial, "e2", "e4").state;
  const queenPawn = answer(initial, "d2", "d4").state;
  assert.deepEqual(kingPawn.moves, ["e4", "e5"]);
  assert.deepEqual(queenPawn.moves, ["d4", "d5"]);
  assert.deepEqual([...queenPawn.position.continuations.values()].map(({ move }) => move.san), ["c4"]);
  assert.equal(answer(queenPawn, "c2", "c4").state.status, "complete");
  assert.equal(initial.position.continuations.size, 2);
});

test("Black automatically receives one saved White opening move", () => {
  const tree = root("1. e4 c6 *", "1. d4 d5 *");
  const initial = startExercise(tree, "b", first);
  assert.deepEqual(initial.moves, ["e4"]);
  assert.equal(initial.status, "player");
  assert.equal(initial.position.turn, "b");
  assert.strictEqual(playOpponent(initial, () => assert.fail("Played twice")), initial);
  const completed = answer(initial, "c7", "c6").state;
  assert.equal(completed.status, "complete");
  assert.strictEqual(playOpponent(completed, first), completed);
  assert.strictEqual(answer(completed, "c7", "c6").state, completed);
  assert.deepEqual(completed.stats, { attempted: 1, firstCorrect: 1, incorrect: 0, hints: 0, reveals: 0, completed: 1 });
  assert.deepEqual(startExercise(tree, "b", last).moves, ["d4"]);
});

test("opponent chooses among distinct saved moves and short branches complete at the leaf", () => {
  const tree = root("1. e4 e5 *", "1. e4 e5 2. Nf3 *", "1. e4 c5 *");
  const initial = startExercise(tree, "w", first);
  const long = answer(initial, "e2", "e4").state;
  assert.deepEqual(long.moves, ["e4", "e5"]);
  assert.equal(long.status, "player");
  assert.equal(answer(long, "g1", "f3").state.stats.completed, 1);
  const short = answer(initial, "e2", "e4", last).state;
  assert.deepEqual(short.moves, ["e4", "c5"]);
  assert.equal(short.status, "complete");
  assert.equal(short.stats.completed, 1);
});

test("custom FEN roots respect the active color and keep promotions distinct", () => {
  const fen = "7k/8/8/8/8/8/p7/7K b - - 0 10";
  const header = `[SetUp "1"]\n[FEN "${fen}"]\n\n`;
  const source = Object.freeze(lines(header + "10... a1=N *", header + "10... a1=Q+ *", "1. e4 e5 *"));
  const before = JSON.stringify(source);
  const { roots } = buildTrainingTree(source);
  assert.equal(roots.length, 2);
  const custom = selectRoot(roots, first);
  assert.notEqual(selectRoot(roots, first, custom), custom);
  const black = startExercise(custom, "b", first);
  assert.equal(black.position.fen, fen);
  assert.deepEqual(black.moves, []);
  assert.deepEqual(answer(black, "a2", "a1", first, "n").state.moves, ["a1=N"]);
  const white = startExercise(custom, "w", last);
  assert.deepEqual(white.moves, ["a1=Q+"]);
  assert.equal(white.status, "complete");
  assert.equal(JSON.stringify(source), before);
});

test("a scheduled mid-variation position starts directly at its saved FEN and context", () => {
  const tree = root("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
  const fen = new Chess();
  fen.move("e4"); fen.move("e5");
  const position = trainingPositionAt(tree, ["e4", "e5"], fen.fen());
  assert.ok(position);
  const exercise = startExerciseAt(tree, position, "w", first, ["e4", "e5"]);
  assert.equal(exercise.position.fen, fen.fen());
  assert.deepEqual(exercise.moves, ["e4", "e5"]);
  assert.equal(exercise.status, "player");
  assert.deepEqual(answer(exercise, "g1", "f3").state.moves, ["e4", "e5", "Nf3", "Nc6"]);
  assert.equal(trainingPositionAt(tree, ["e4", "e5", "Nf3"], "invalid FEN"), null);
});

test("mistakes, retries, hints and reveals produce accurate session statistics", () => {
  const tree = root("1. e4 e5 2. Nf3 Nc6 3. Bb5 *");
  const start = startExercise(tree, "w", first);
  const illegal = answer(start, "e2", "e5");
  assert.equal(illegal.accepted, false);
  assert.match(illegal.state.feedback, /illegal/);
  assert.deepEqual(illegal.state.stats, start.stats);
  const wrong = answer(illegal.state, "d2", "d4");
  assert.equal(wrong.accepted, false);
  assert.match(wrong.state.feedback, /outside/);
  assert.strictEqual(wrong.state.position, start.position);
  assert.equal(wrong.state.incorrectHere, 1);
  const retry = answer(wrong.state, "e2", "e4").state;
  const hinted = requestHint(retry);
  assert.match(hinted.hint, /knight/);
  assert.strictEqual(requestHint(hinted), hinted);
  assert.equal(hinted.hintsHere, 1);
  const next = answer(hinted, "g1", "f3").state;
  const revealed = revealAnswer(next);
  assert.equal(revealed.revealed, "Bb5");
  assert.strictEqual(revealAnswer(revealed), revealed);
  assert.equal(revealed.revealsHere, 1);
  const result = answer(revealed, "f1", "b5").state;
  assert.equal(result.status, "complete");
  assert.deepEqual(result.stats, { attempted: 3, firstCorrect: 0, incorrect: 1, hints: 1, reveals: 1, completed: 1 });
  const restarted = startExercise(tree, "w", first, result.stats);
  assert.equal(restarted.attemptedHere, false);
  assert.equal(restarted.revealed, "");
  assert.deepEqual(restarted.stats, result.stats);
  const ended = endExercise(restarted);
  assert.equal(ended.status, "ended");
  assert.strictEqual(answer(ended, "e2", "e4").state, ended);
});

test("empty chapters and malformed lines produce no invalid continuations", () => {
  assert.deepEqual(buildTrainingTree([]).roots, []);
  const { roots, skipped } = buildTrainingTree(lines("1. e4 e5 2. e8 *", "1. d4 *"));
  assert.equal(skipped, 1);
  assert.equal(roots[0].continuations.size, 1);
});
