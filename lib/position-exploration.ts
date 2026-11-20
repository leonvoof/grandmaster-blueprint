import { Chess } from "chess.js";
import { classifyEvaluationMove, MIN_CLASSIFICATION_DEPTH, type ClassificationThresholds, type ClassifiedMove } from "@/lib/game-review-classification";
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

export function normalizeExplorationAnalysis(analysis: Analysis, engineBuild: string): Analysis {
  return { ...analysis, engine: engineBuild };
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

export function classifyExplorationMove(before: ExplorationNode, after: ExplorationNode, beforeAnalysis: Analysis | null, afterAnalysis: Analysis | null, thresholds: ClassificationThresholds, minimumDepth = MIN_CLASSIFICATION_DEPTH): ClassifiedMove | null {
  if (!after.san || after.parentId !== before.id) return null;
  try {
    const chess = new Chess(before.fen);
    const color = chess.turn() === "w" ? "white" : "black";
    const assessment = classifyEvaluationMove({ fen: before.fen, played: after.san, before: beforeAnalysis, after: afterAnalysis, thresholds, minimumDepth });
    return assessment.classification ? { ply: after.ply, san: after.san, color, ...assessment } : null;
  } catch { return null; }
}
