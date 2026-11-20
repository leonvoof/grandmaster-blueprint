import test from "node:test";
import assert from "node:assert/strict";
import { boardMoveAnnotation, boardSquareCell } from "../lib/board-annotations.ts";

test("board annotations use the existing classification names and restrained symbols", () => {
  assert.deepEqual(boardMoveAnnotation("Brilliant"), { symbol: "!!", color: "#53dbc5", tone: "vivid" });
  assert.deepEqual(boardMoveAnnotation("Great"), { symbol: "!", color: "#6da7ff", tone: "vivid" });
  assert.deepEqual(boardMoveAnnotation("Best"), { symbol: "★", color: "#77dc8e", tone: "vivid" });
  assert.equal(boardMoveAnnotation("Inaccuracy")?.symbol, "?!");
  assert.equal(boardMoveAnnotation("Mistake")?.symbol, "?");
  assert.equal(boardMoveAnnotation("Blunder")?.symbol, "??");
  assert.equal(boardMoveAnnotation("Excellent")?.tone, "subtle");
  assert.equal(boardMoveAnnotation("Good")?.tone, "subtle");
  assert.equal(boardMoveAnnotation("Book"), null);
  assert.equal(boardMoveAnnotation(null), null);
});

test("destination-square overlay cell follows white and black board orientation", () => {
  assert.deepEqual(boardSquareCell("d6", "white"), { column: 3, row: 2 });
  assert.deepEqual(boardSquareCell("d6", "black"), { column: 4, row: 5 });
  assert.deepEqual(boardSquareCell("a1", "white"), { column: 0, row: 7 });
  assert.deepEqual(boardSquareCell("a1", "black"), { column: 7, row: 0 });
  assert.equal(boardSquareCell("z9", "white"), null);
});
