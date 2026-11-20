import { Chess } from "chess.js";
import { type OpeningEntry, type OpeningLibrary } from "./built-in-openings.ts";
import { type ExplorationTree } from "./position-exploration.ts";
import { publicExplorationTarget } from "./public-exploration.ts";

export function catalogExploration(library: OpeningLibrary, entries: readonly OpeningEntry[]) {
  const chess = new Chess();
  const tree: ExplorationTree = {
    rootId: "0", currentId: "0", nextId: 1,
    nodes: { "0": { id: "0", parentId: null, ply: 0, fen: chess.fen(), san: null, from: null, to: null, promotion: null, source: "root", children: [] } },
  };
  const byMove = new Map<string, string>();
  const endpoints = new Map<number, string>();
  for (const entry of entries) {
    let parent = tree.nodes[tree.rootId];
    for (const uci of library.line(entry)) {
      const key = `${parent.id}:${uci}`;
      let id = byMove.get(key);
      if (!id) {
        chess.load(parent.fen);
        const move = chess.move(uci);
        id = String(tree.nextId++);
        byMove.set(key, id);
        parent.children.push(id);
        tree.nodes[id] = { id, parentId: parent.id, ply: parent.ply + 1, fen: chess.fen(), san: move.san, from: move.from, to: move.to, promotion: move.promotion ?? null, source: "game", children: [] };
      }
      parent = tree.nodes[id];
    }
    endpoints.set(entry.id, parent.id);
  }
  return { tree, endpoints };
}

export const explorerKeys = ["Home", "ArrowLeft", "ArrowRight", "End", "ArrowUp", "ArrowDown"] as const;

export function openingExplorerTarget(tree: ExplorationTree, preferred: Record<string, string>, key: string) {
  if (key === "Home" || key === "End") return publicExplorationTarget(tree, key === "Home" ? "ArrowUp" : "ArrowDown", preferred);
  if (key === "ArrowLeft" || key === "ArrowRight") return publicExplorationTarget(tree, key, preferred);
  const parent = tree.nodes[tree.currentId].parentId;
  if (!parent || (key !== "ArrowUp" && key !== "ArrowDown")) return null;
  const siblings = tree.nodes[parent].children;
  return siblings[siblings.indexOf(tree.currentId) + (key === "ArrowUp" ? -1 : 1)] ?? null;
}
