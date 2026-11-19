import test from "node:test";
import assert from "node:assert/strict";

const {
  evaluationBarState,
  gameViewerPositionForKey,
  resolveBoardOrientation,
  shouldIgnoreGameViewerShortcut,
  whiteEvaluationFillEdge,
} = await import("../lib/game-viewer-controls.ts");

test("move keys navigate one ply and jump to game boundaries", () => {
  assert.equal(gameViewerPositionForKey("ArrowLeft", 3, 12), 2);
  assert.equal(gameViewerPositionForKey("ArrowLeft", 0, 12), 0);
  assert.equal(gameViewerPositionForKey("ArrowRight", 3, 12), 4);
  assert.equal(gameViewerPositionForKey("ArrowRight", 12, 12), 12);
  assert.equal(gameViewerPositionForKey("ArrowUp", 8, 12), 0);
  assert.equal(gameViewerPositionForKey("ArrowDown", 2, 12), 12);
  assert.equal(gameViewerPositionForKey("a", 2, 12), null);
});

test("keyboard shortcuts are ignored in editable controls and dialogs", () => {
  const targetFor = (matched) => ({ closest: () => matched });
  assert.equal(shouldIgnoreGameViewerShortcut(null), false);
  assert.equal(shouldIgnoreGameViewerShortcut(targetFor(true)), true);
  assert.equal(shouldIgnoreGameViewerShortcut(targetFor(false)), false);
});

test("auto orientation follows the connected Lichess player and falls back to White", () => {
  assert.equal(resolveBoardOrientation("auto", "myuser", { White: "Opponent", Black: "MyUser" }), "black");
  assert.equal(resolveBoardOrientation("auto", "myuser", { White: "MYUSER", Black: "Opponent" }), "white");
  assert.equal(resolveBoardOrientation("auto", null, { White: "Other", Black: "Player" }), "white");
  assert.equal(resolveBoardOrientation("black", "myuser", { White: "MyUser", Black: "Other" }), "black");
});

test("evaluation bar keeps score polarity in White's perspective and separates mate", () => {
  const whiteAdvantage = evaluationBarState({ kind: "cp", value: 250 });
  const blackAdvantage = evaluationBarState({ kind: "cp", value: -180 });
  assert.equal(whiteAdvantage.label, "+2.50");
  assert.equal(whiteAdvantage.whitePercent, 75);
  assert.equal(blackAdvantage.label, "-1.80");
  assert.equal(blackAdvantage.whitePercent, 32);
  assert.equal(evaluationBarState({ kind: "mate", value: -3 }).label, "Black M3");
  assert.equal(evaluationBarState(null).known, false);
  assert.equal(evaluationBarState(null, "Stalemate").label, "Draw");
  assert.equal(whiteEvaluationFillEdge("white"), "bottom");
  assert.equal(whiteEvaluationFillEdge("black"), "top");
});
