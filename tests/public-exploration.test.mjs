import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { addExplorationMove, createExplorationTree, selectExplorationNode } from "../lib/position-exploration.ts";
import { publicExplorationTarget, rememberPath, validateVariationEdges, variationEdges } from "../lib/public-exploration.ts";

test("public shortcuts follow the selected variation and jump to its boundaries", () => {
  let tree = createExplorationTree(new Chess().fen(), 0);
  tree = addExplorationMove(tree, "e2", "e4").tree;
  const main = tree.currentId;
  tree = selectExplorationNode(tree, tree.rootId);
  tree = addExplorationMove(tree, "d2", "d4").tree;
  const alternative = tree.currentId;
  tree = addExplorationMove(tree, "d7", "d5").tree;
  const end = tree.currentId;
  const preferred = {};
  rememberPath(tree, end, preferred);
  assert.equal(publicExplorationTarget(tree, "ArrowUp", preferred), tree.rootId);
  assert.equal(publicExplorationTarget(tree, "ArrowLeft", preferred), alternative);
  tree = selectExplorationNode(tree, tree.rootId);
  assert.equal(publicExplorationTarget(tree, "ArrowRight", preferred), alternative);
  assert.equal(publicExplorationTarget(tree, "ArrowDown", preferred), end);
  rememberPath(tree, main, preferred);
  assert.equal(publicExplorationTarget(tree, "ArrowDown", preferred), main);
});

test("serializes explored edges in legal replay order and rejects malformed backup moves", () => {
  let tree = createExplorationTree(new Chess().fen(), 0);
  tree = addExplorationMove(tree, "e2", "e4").tree;
  tree = addExplorationMove(tree, "c7", "c5").tree;
  const edges = variationEdges(tree);
  assert.deepEqual(validateVariationEdges(JSON.parse(JSON.stringify(edges))), [
    { parent: "0", from: "e2", to: "e4", promotion: null },
    { parent: "1", from: "c7", to: "c5", promotion: null },
  ]);
  assert.throws(() => validateVariationEdges([{ ...edges[0], to: "i9" }]));
});
