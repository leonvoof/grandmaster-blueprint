import { Chess } from "chess.js";
import { createExplorationTree, selectExplorationNode, type ExplorationMove } from "./position-exploration.ts";

export function canAnalyzePuzzle(completedPlies: number, solutionLength: number, revealed: boolean) {
  return revealed || (solutionLength > 0 && completedPlies === solutionLength);
}

export function createPuzzleAnalysis(fen: string, solution: readonly string[], completedPlies: number, revealed: boolean) {
  if (!canAnalyzePuzzle(completedPlies, solution.length, revealed)) return null;
  const board = new Chess(fen);
  const played: ExplorationMove[] = solution.slice(0, completedPlies).map((uci) => {
    const { from, to, promotion, san } = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { from, to, promotion, san, fen: board.fen() };
  });
  const ply = (Number(fen.split(" ")[5]) - 1) * 2 + Number(fen.split(" ")[1] === "b");
  return selectExplorationNode(createExplorationTree(fen, ply, played), String(played.length));
}
