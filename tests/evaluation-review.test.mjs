import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { findCriticalMoves, evaluationValue } from "../lib/evaluation-review.ts";
import { classifyGameMoves, summarizeClassifiedMoves } from "../lib/game-review-classification.ts";

const thresholds = { inaccuracy: 50, mistake: 100, blunder: 200 };
const analysis = (value, variation, depth = 12, kind = "cp") => ({
  engine: "sf19", depth, score: { kind, value }, bestMove: variation[0], variation,
});

test("mistake review selects the same moves and severity as the classification summary", () => {
  const chess = new Chess();
  const point = (ply, san, value, variation) => {
    if (san) chess.move(san);
    return { ply, san, fen: chess.fen(), settings: "lite", analysis: analysis(value, variation) };
  };
  const points = [
    point(0, null, 800, ["Nf3"]),
    point(1, "e4", 500, ["Nc6"]),
    point(2, "e5", 600, ["Nf3"]),
    point(3, "a3", -250, ["Nf6"]),
  ];
  const moves = classifyGameMoves(points, thresholds);
  assert.equal(moves[0].classification, "Good");
  const [mistake] = findCriticalMoves(points, thresholds);
  assert.equal(mistake.ply, 3);
  assert.equal(mistake.loss, 8.5);
  assert.equal(mistake.classification, "Blunder");
  assert.equal(mistake.fen, points[2].fen);
  assert.equal(mistake.alternative, "Nf3");
  assert.deepEqual(summarizeClassifiedMoves(moves).critical.map(({ ply, classification }) => ({ ply, classification })),
    [{ ply: mistake.ply, classification: mistake.classification }]);
  assert.deepEqual(evaluationValue(analysis(-3, [], 12, "mate")), { evaluation: null, mate: -3 });
  assert.equal(findCriticalMoves([points[2], { ...points[3], analysis: null }], thresholds).length, 0);
  assert.equal(findCriticalMoves([points[2], { ...points[3], settings: "different" }], thresholds).length, 0);
});

test("uses the starting FEN to classify a Black first move and keep PGN numbering", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 7";
  const start = { ply: 0, san: null, analysis: analysis(-100, ["Nc6"]), fen };
  const after = { ply: 1, san: "e5", analysis: analysis(120, []) };
  const [move] = findCriticalMoves([start, after], thresholds);
  assert.equal(move.color, "black");
  assert.equal(move.moveNumber, 7);
  assert.equal(move.san, "e5");
  assert.equal(move.classification, "Blunder");
});
