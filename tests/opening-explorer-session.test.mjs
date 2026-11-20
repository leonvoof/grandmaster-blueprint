import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Chess } from "chess.js";
import { openingLibrary } from "../lib/built-in-openings.ts";
import { catalogExploration, openingExplorerTarget } from "../lib/opening-explorer-session.ts";
import { addExplorationMove, explorationPath, selectExplorationNode } from "../lib/position-exploration.ts";
import { rememberPath } from "../lib/public-exploration.ts";

const library = openingLibrary(JSON.parse(readFileSync(new URL("../public/opening-library/lichess-cc0.json", import.meta.url))));

test("catalog joins shared prefixes and all exact named positions remain navigable", () => {
  const entries = library.families.get("Caro-Kann Defense");
  const { tree, endpoints } = catalogExploration(library, entries);
  assert.equal(endpoints.size, 110);
  assert.equal(tree.nodes[tree.rootId].children.length, 1);
  assert.ok(Object.values(tree.nodes).some((node) => node.children.length > 1));
  for (const entry of entries) {
    const id = endpoints.get(entry.id);
    const chess = new Chess();
    for (const move of library.line(entry)) chess.move(move);
    assert.equal(tree.nodes[id].fen, chess.fen());
    assert.equal(tree.nodes[id].source, "game");
  }
});

test("keyboard navigation follows preferred branches while restoring siblings and exact positions", () => {
  const { tree, endpoints } = catalogExploration(library, library.families.get("Caro-Kann Defense"));
  const base = library.search("B10 Caro-Kann Defense")[0];
  const atBase = selectExplorationNode(tree, endpoints.get(base.id));
  const first = addExplorationMove(atBase, "h2", "h3").tree;
  const second = addExplorationMove(atBase, "a2", "a3").tree;
  assert.notEqual(atBase.nodes[atBase.currentId].fen, first.nodes[first.currentId].fen);
  const branched = addExplorationMove(selectExplorationNode(first, atBase.currentId), "a2", "a3").tree;
  assert.equal(branched.nodes[branched.currentId].fen, second.nodes[second.currentId].fen);
  const preferred = {};
  rememberPath(branched, branched.currentId, preferred);
  const up = openingExplorerTarget(branched, preferred, "ArrowUp");
  assert.equal(up, first.currentId);
  assert.equal(openingExplorerTarget(selectExplorationNode(branched, up), preferred, "ArrowDown"), branched.currentId);
  assert.equal(openingExplorerTarget(branched, preferred, "ArrowLeft"), atBase.currentId);
  assert.equal(openingExplorerTarget(selectExplorationNode(branched, atBase.currentId), preferred, "ArrowRight"), branched.currentId);
  assert.equal(openingExplorerTarget(branched, preferred, "Home"), tree.rootId);
  assert.equal(openingExplorerTarget(selectExplorationNode(branched, tree.rootId), preferred, "End"), branched.currentId);
  assert.equal(explorationPath(branched).at(-1).source, "exploration");
});
