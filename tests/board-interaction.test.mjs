import assert from "node:assert/strict";
import { test } from "node:test";
import { boardAnimationDuration, legalMoveTargets } from "../lib/board-interaction.ts";

test("selected pieces receive only legal destination squares", () => {
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.deepEqual(legalMoveTargets(start, "e2"), [{ square: "e3", capture: false }, { square: "e4", capture: false }]);
  assert.deepEqual(legalMoveTargets(start, "e7"), []);
  assert.deepEqual(legalMoveTargets("invalid fen", "e2"), []);
});

test("captures including en passant use capture destinations", () => {
  const fen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1";
  assert.deepEqual(legalMoveTargets(fen, "e5").find(({ square }) => square === "d6"), { square: "d6", capture: true });
});

test("castling and promotion destinations are included and deduplicated", () => {
  const castle = legalMoveTargets("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1");
  assert.ok(castle.some(({ square }) => square === "g1"));
  assert.ok(castle.some(({ square }) => square === "c1"));

  const promotion = legalMoveTargets("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7");
  assert.deepEqual(promotion.filter(({ square }) => square === "a8"), [{ square: "a8", capture: false }]);
  const capturePromotion = legalMoveTargets("1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7");
  assert.deepEqual(capturePromotion.find(({ square }) => square === "b8"), { square: "b8", capture: true });
});

test("board animation is smooth by default and disabled for reduced motion", () => {
  assert.equal(boardAnimationDuration(false), 220);
  assert.equal(boardAnimationDuration(true), 0);
});
