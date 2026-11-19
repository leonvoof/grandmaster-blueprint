import { Chess } from "chess.js";
import type { ClassificationThresholds, ClassifiedMove } from "@/lib/game-review-classification";
import type { Analysis } from "@/lib/stockfish/position";

export type ExplorationMove = { san: string; fen: string; from: string; to: string; promotion?: string | null };
export type ExplorationNode = { id: string; parentId: string | null; ply: number; fen: string; san: string | null; from: string | null; to: string | null; promotion: string | null; source: "root" | "game" | "exploration"; children: string[] };
export type ExplorationTree = { rootId: string; currentId: string; nextId: number; nodes: Record<string, ExplorationNode> };

export function rememberExplorationPositions(previous: string[], ...nodeIds: string[]) {
  return [...new Set([...previous, ...nodeIds])];
}

export function explorationAnalysisQueue(tree: ExplorationTree, currentId: string, requiredIds: string[]) {
  return [...new Set([currentId, ...requiredIds])].filter((id) => Boolean(tree.nodes[id]));
}

export function explorationAnalysisIdentity(rootFen: string, node: ExplorationNode, depth: number, engine: string, settings: string, gameId: string | null) {
  return JSON.stringify([gameId, rootFen, node.id, node.fen, engine, settings, depth]);
}

export function createExplorationTree(rootFen: string, rootPly: number, originalLine: ExplorationMove[] = []): ExplorationTree {
  const root: ExplorationNode = { id: "0", parentId: null, ply: rootPly, fen: new Chess(rootFen).fen(), san: null, from: null, to: null, promotion: null, source: "root", children: [] };
  const nodes: Record<string, ExplorationNode> = { "0": root };
  let parent = root;
  let nextId = 1;
  for (const move of originalLine) {
    const chess = new Chess(parent.fen);
    const legal = chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? "q" });
    if (legal.san !== move.san || chess.fen() !== move.fen) throw new Error("The saved game line did not match its legal position sequence.");
    const id = String(nextId++);
    const node: ExplorationNode = { id, parentId: parent.id, ply: parent.ply + 1, fen: chess.fen(), san: legal.san, from: move.from, to: move.to, promotion: legal.promotion ?? null, source: "game", children: [] };
    parent.children.push(id); nodes[id] = node; parent = node;
  }
  return { rootId: root.id, currentId: root.id, nextId, nodes };
}

export function addExplorationMove(tree: ExplorationTree, from: string, to: string, promotion: "q" | "r" | "b" | "n" = "q") {
  const parent = tree.nodes[tree.currentId];
  const chess = new Chess(parent.fen);
  const move = chess.move({ from, to, promotion });
  const existing = parent.children.map((id) => tree.nodes[id]).find((node) => node.from === from && node.to === to && (node.promotion ?? "q") === promotion);
  if (existing) return { tree: { ...tree, currentId: existing.id }, move, created: false };
  const id = String(tree.nextId);
  const node: ExplorationNode = { id, parentId: parent.id, ply: parent.ply + 1, fen: chess.fen(), san: move.san, from, to, promotion: move.promotion ?? null, source: "exploration", children: [] };
  return { tree: { ...tree, currentId: id, nextId: tree.nextId + 1, nodes: { ...tree.nodes, [parent.id]: { ...parent, children: [...parent.children, id] }, [id]: node } }, move, created: true };
}

export function selectExplorationNode(tree: ExplorationTree, id: string): ExplorationTree {
  if (!tree.nodes[id]) throw new Error("Unknown exploration position.");
  return { ...tree, currentId: id };
}

export function undoExplorationMove(tree: ExplorationTree): ExplorationTree {
  const parentId = tree.nodes[tree.currentId].parentId;
  return parentId ? { ...tree, currentId: parentId } : tree;
}

export function explorationArrowTarget(tree: ExplorationTree, key: string): string | null {
  const current = tree.nodes[tree.currentId];
  if (key === "ArrowLeft") return current.parentId;
  if (key === "ArrowRight") return current.children[0] ?? null;
  if (key !== "ArrowUp" && key !== "ArrowDown" || !current.parentId) return null;
  const siblings = tree.nodes[current.parentId].children;
  const index = siblings.indexOf(current.id);
  const targetIndex = key === "ArrowUp" ? Math.max(0, index - 1) : Math.min(siblings.length - 1, index + 1);
  return siblings[targetIndex] ?? null;
}

export function explorationPath(tree: ExplorationTree, id = tree.currentId): ExplorationNode[] {
  const path: ExplorationNode[] = [];
  let node: ExplorationNode | undefined = tree.nodes[id];
  while (node) { path.unshift(node); node = node.parentId ? tree.nodes[node.parentId] : undefined; }
  return path;
}

export function classifyExplorationMove(before: ExplorationNode, after: ExplorationNode, beforeAnalysis: Analysis | null, afterAnalysis: Analysis | null, thresholds: ClassificationThresholds, minimumDepth = 6): ClassifiedMove | null {
  if (!after.san || !beforeAnalysis?.score || !afterAnalysis?.score || beforeAnalysis.engine !== afterAnalysis.engine || beforeAnalysis.depth !== afterAnalysis.depth || beforeAnalysis.depth < minimumDepth || beforeAnalysis.score.kind !== "cp" || afterAnalysis.score.kind !== "cp") return null;
  try {
    const replay = new Chess(before.fen);
    const legalVariation = beforeAnalysis.variation.map((san) => replay.move(san).san);
    const played = new Chess(before.fen).move({ from: after.from!, to: after.to!, promotion: after.promotion ?? "q" }).san;
    const lossCp = new Chess(before.fen).turn() === "w" ? beforeAnalysis.score.value - afterAnalysis.score.value : afterAnalysis.score.value - beforeAnalysis.score.value;
    const evaluationBefore = beforeAnalysis.score.value / 100;
    const evaluationAfter = afterAnalysis.score.value / 100;
    let classification: ClassifiedMove["classification"];
    let reason: string;
    if (legalVariation[0] === played) { classification = "Best"; reason = "Matches the first legal move in the saved pre-move principal variation."; }
    else if (lossCp >= thresholds.blunder) { classification = "Blunder"; reason = `Lost ${lossCp} cp from the mover's perspective (blunder threshold ${thresholds.blunder} cp).`; }
    else if (lossCp >= thresholds.mistake) { classification = "Mistake"; reason = `Lost ${lossCp} cp from the mover's perspective (mistake threshold ${thresholds.mistake} cp).`; }
    else if (lossCp >= thresholds.inaccuracy) { classification = "Inaccuracy"; reason = `Lost ${lossCp} cp from the mover's perspective (inaccuracy threshold ${thresholds.inaccuracy} cp).`; }
    else if (lossCp <= 10) { classification = "Excellent"; reason = `Evaluation loss was ${lossCp} cp, within the 10 cp Excellent band.`; }
    else { classification = "Good"; reason = `Evaluation loss was ${lossCp} cp, below the configured inaccuracy threshold.`; }
    return { ply: after.ply, san: after.san, color: new Chess(before.fen).turn() === "w" ? "white" : "black", classification, lossCp, evaluationBefore, evaluationAfter, bestMove: legalVariation[0] ?? null, continuation: legalVariation, reason };
  } catch { return null; }
}
