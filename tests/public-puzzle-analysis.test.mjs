import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { addExplorationMove, explorationPath, selectExplorationNode, undoExplorationMove } from "../lib/position-exploration.ts";
import { canAnalyzePuzzle, createPuzzleAnalysis } from "../lib/puzzle-analysis.ts";
import { puzzles } from "../lib/public-progress.ts";
import { parsePuzzleRow } from "../lib/tactics.ts";
import { analysisPosition } from "../lib/stockfish/position.ts";

test("analysis is locked until solved or revealed, including after partial progress", () => {
  assert.equal(canAnalyzePuzzle(0, 3, false), false);
  assert.equal(canAnalyzePuzzle(2, 3, false), false);
  assert.equal(canAnalyzePuzzle(0, 0, false), false);
  assert.equal(createPuzzleAnalysis(DEFAULT_POSITION, ["e2e4"], 0, false), null);

  const study = createPuzzleAnalysis(DEFAULT_POSITION, ["e2e4", "e7e5", "g1f3"], 2, true);
  assert.deepEqual(explorationPath(study).map(({ san }) => san), [null, "e4", "e5"]);
  assert.equal(study.nodes[study.currentId].children.length, 0);
  const immediate = createPuzzleAnalysis(DEFAULT_POSITION, ["e2e4"], 0, true);
  assert.equal(immediate.nodes[immediate.currentId].fen, DEFAULT_POSITION);
});

test("a solved Lichess fallback opens on its final FEN and retains the played line", () => {
  const row = puzzles[0];
  const start = parsePuzzleRow(row).fen;
  const solution = row.moves.split(" ").slice(1);
  const expected = new Chess(start);
  for (const move of solution) expected.move(move);

  const study = createPuzzleAnalysis(start, solution, solution.length, false);
  assert.equal(study.nodes[study.currentId].fen, expected.fen());
  assert.equal(explorationPath(study).length, solution.length + 1);
  assert.equal(study.nodes[study.rootId].ply, 48);

  const mate = createPuzzleAnalysis(DEFAULT_POSITION, ["f2f3", "e7e5", "g2g4", "d8h4"], 4, false);
  assert.equal(analysisPosition(mate.nodes[mate.currentId].fen).terminal, "White is checkmated");
  assert.equal(analysisPosition(undoExplorationMove(mate).nodes["3"].fen).terminal, undefined);
});

test("free play handles both sides and preserves the entry tree while branching", () => {
  const baseline = createPuzzleAnalysis(DEFAULT_POSITION, ["e2e4"], 0, true);
  const original = JSON.stringify(baseline);
  assert.throws(() => addExplorationMove(baseline, "e2", "e5"));
  const first = addExplorationMove(baseline, "e2", "e4").tree;
  const e5 = addExplorationMove(first, "e7", "e5").tree;
  const c5 = addExplorationMove(undoExplorationMove(e5), "c7", "c5").tree;
  const parent = undoExplorationMove(c5);
  assert.deepEqual(parent.nodes[parent.currentId].children.map((id) => parent.nodes[id].san), ["e5", "c5"]);
  assert.equal(selectExplorationNode(parent, e5.currentId).nodes[e5.currentId].san, "e5");
  assert.equal(JSON.stringify(baseline), original);
});

test("analysis branches support castling, en passant, underpromotion, and check notation", () => {
  const castle = createPuzzleAnalysis("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", [], 0, true);
  assert.equal(addExplorationMove(castle, "e1", "g1").move.san, "O-O");
  const enPassant = createPuzzleAnalysis("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2", [], 0, true);
  assert.ok(addExplorationMove(enPassant, "e5", "d6").move.isEnPassant());
  const promotion = createPuzzleAnalysis("8/P1k5/8/8/8/8/8/4K3 w - - 0 1", [], 0, true);
  assert.equal(addExplorationMove(promotion, "a7", "a8", "n").move.san, "a8=N+");
});
