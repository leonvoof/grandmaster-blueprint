import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPuzzleNextUrl, parseNextPuzzle, parsePuzzleRow, puzzleDifficultyOptions, puzzleThemeOptions } from "../lib/tactics.ts";

test("difficulty and theme selectors map to Lichess puzzle-next parameters", () => {
  assert.deepEqual(puzzleDifficultyOptions.map(({ label, value }) => [label, value]), [
    ["Very Easy", "easiest"], ["Easy", "easier"], ["Normal", "normal"], ["Hard", "harder"], ["Very Hard", "hardest"],
  ]);
  assert.deepEqual(puzzleThemeOptions.map(({ label, value }) => [label, value]), [
    ["Mixed", "mix"], ["Forks", "fork"], ["Pins", "pin"], ["Checkmates", "mate"], ["Mate in 1", "mateIn1"],
    ["Sacrifices", "sacrifice"], ["Endgames", "endgame"], ["Skewers", "skewer"],
    ["Discovered Attacks", "discoveredAttack"], ["Hanging Pieces", "hangingPiece"],
  ]);
  const request = new URL(buildPuzzleNextUrl("harder", "discoveredAttack"));
  assert.equal(request.origin, "https://lichess.org");
  assert.equal(request.pathname, "/api/puzzle/next");
  assert.equal(request.searchParams.get("difficulty"), "harder");
  assert.equal(request.searchParams.get("angle"), "discoveredAttack");
});

test("Lichess puzzle-next puzzle FEN and solution are validated as returned", () => {
  const row = parseNextPuzzle({ puzzle: { id: "T9nmF", fen: "r2qr1k1/1p3ppp/p1n2n2/4p2b/4N3/P2P1N1P/1PPQBPP1/R4RK1 b - - 0 1", lastMove: "e1d2", solution: ["f6e4", "d3e4", "d8d2"], rating: 1442, themes: ["middlegame", "crushing"] } });
  const parsed = parsePuzzleRow(row);
  assert.equal(parsed.id, "T9nmF");
  assert.deepEqual(JSON.parse(parsed.solution), ["f6e4", "d3e4", "d8d2"]);
  assert.equal(parsed.rating, 1442);
});

test("rejects malformed puzzle-next responses and illegal solution sequences", () => {
  assert.throws(() => parseNextPuzzle({ puzzle: { id: "x", fen: "bad", lastMove: "e2e4", solution: ["e7e5"], rating: 1000, themes: [] } }));
  assert.throws(() => parseNextPuzzle({ puzzle: { id: "x", fen: "8/8/8/8/8/8/8/8 w - - 0 1", lastMove: "a1a8", solution: ["e7e5"], rating: 1000, themes: [] } }));
});
