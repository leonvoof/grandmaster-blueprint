import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier.startsWith("@/") ? nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context) : nextResolve(specifier, context);
} });

const { continuationPosition, getReviewHint, mistakeReviewTargetForKey, reviewBoardOrientation, reviewPlayerColor } = await import("../lib/mistake-review-ui.ts");

test("review board follows the side to move for White and Black mistakes", () => {
  assert.equal(reviewPlayerColor(1), "white");
  assert.equal(reviewPlayerColor(2), "black");
  assert.equal(reviewPlayerColor(7), "white");
  assert.equal(reviewBoardOrientation("auto", "black"), "black");
  assert.equal(reviewBoardOrientation("auto", "white"), "white");
  assert.equal(reviewBoardOrientation("auto", null), "white");
  assert.equal(reviewBoardOrientation("white", "black"), "white");
});

test("review arrow keys move between mistakes and never map to answer or submit actions", () => {
  assert.equal(mistakeReviewTargetForKey("ArrowLeft", 0, 4), 0);
  assert.equal(mistakeReviewTargetForKey("ArrowLeft", 3, 4), 2);
  assert.equal(mistakeReviewTargetForKey("ArrowRight", 3, 4), 4);
  assert.equal(mistakeReviewTargetForKey("r", 1, 4), null);
  assert.equal(mistakeReviewTargetForKey("Enter", 1, 4), null);
});

test("hints disclose a saved piece type without exposing the move", () => {
  const hint = getReviewHint("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "Nf3");
  assert.match(hint, /knight/);
  assert.doesNotMatch(hint, /Nf3/);
  assert.match(getReviewHint("8/8/8/8/8/8/4k3/4K3 w - - 0 1", null), /No saved engine move/);
});

test("engine continuation advances legally from the pre-move position", () => {
  const before = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const afterOne = continuationPosition(before, ["e4", "e5", "Nf3"], 1);
  const afterThree = continuationPosition(before, ["e4", "e5", "Nf3"], 3);
  assert.match(afterOne, / b KQkq /);
  assert.match(afterThree, / b KQkq /);
  assert.throws(() => continuationPosition(before, ["e4", "Qh5"], 2));
});
