import { Chess } from "chess.js";
import type { BoardOrientation } from "@/lib/game-viewer-controls";

export function reviewPlayerColor(ply: number): BoardOrientation {
  return ply % 2 === 1 ? "white" : "black";
}

export function reviewBoardOrientation(mode: "auto" | BoardOrientation, playerToMove: BoardOrientation | null): BoardOrientation {
  return mode === "auto" ? playerToMove ?? "white" : mode;
}

export function mistakeReviewTargetForKey(key: string, index: number, total: number): number | null {
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "ArrowRight") return Math.min(total, index + 1);
  return null;
}

export function getReviewHint(fen: string, bestMove: string | null): string {
  if (!bestMove) return "Look for forcing checks, captures, and direct threats. No saved engine move is available for a more specific hint.";
  try {
    const firstMove = new Chess(fen).move(bestMove);
    const piece = ({ p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" } as const)[firstMove.piece];
    return `The saved top line begins with a ${piece} move. Work out its destination and purpose.`;
  } catch {
    return "Look for forcing checks, captures, and direct threats. The saved move could not be used to create a hint.";
  }
}

export function continuationPosition(fen: string, variation: string[], appliedPlies: number): string {
  const chess = new Chess(fen);
  for (const san of variation.slice(0, appliedPlies)) chess.move(san);
  return chess.fen();
}
