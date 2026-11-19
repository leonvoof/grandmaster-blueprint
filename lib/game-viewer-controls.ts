export type BoardOrientation = "white" | "black";
export type OrientationMode = BoardOrientation | "auto";

export function whiteEvaluationFillEdge(orientation: BoardOrientation): "top" | "bottom" {
  return orientation === "white" ? "bottom" : "top";
}

export function gameViewerPositionForKey(key: string, currentPly: number, totalPlies: number): number | null {
  if (key === "ArrowLeft") return Math.max(0, currentPly - 1);
  if (key === "ArrowRight") return Math.min(totalPlies, currentPly + 1);
  if (key === "ArrowUp") return 0;
  if (key === "ArrowDown") return totalPlies;
  return null;
}

export function shouldIgnoreGameViewerShortcut(target: EventTarget | null): boolean {
  if (!target || !("closest" in target) || typeof target.closest !== "function") return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog[open], [aria-modal="true"]'));
}

export function resolveBoardOrientation(mode: OrientationMode, username: string | null, headers: Record<string, string>): BoardOrientation {
  if (mode !== "auto") return mode;
  return connectedPlayerColor(username, headers) ?? "white";
}

export function connectedPlayerColor(username: string | null, headers: Record<string, string>): BoardOrientation | null {
  if (!username?.trim()) return null;
  const normalizedUsername = username.trim().toLocaleLowerCase();
  if (headers.White?.trim().toLocaleLowerCase() === normalizedUsername) return "white";
  if (headers.Black?.trim().toLocaleLowerCase() === normalizedUsername) return "black";
  return null;
}

export function evaluationBarState(score: { kind: "cp" | "mate"; value: number } | null, terminal?: string) {
  if (score?.kind === "cp") {
    const pawns = score.value / 100;
    return { label: `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`, whitePercent: Math.max(0, Math.min(100, 50 + pawns * 10)), known: true };
  }
  if (score?.kind === "mate") {
    const whitePercent = score.value > 0 ? 100 : score.value < 0 ? 0 : 50;
    return { label: score.value === 0 ? "Mate" : `${score.value > 0 ? "White" : "Black"} M${Math.abs(score.value)}`, whitePercent, known: true };
  }
  if (terminal === "Stalemate" || terminal === "Insufficient material" || terminal === "75-move rule") {
    return { label: terminal === "Stalemate" ? "Draw" : terminal, whitePercent: 50, known: true };
  }
  if (terminal === "White is checkmated") return { label: "Black wins", whitePercent: 0, known: true };
  if (terminal === "Black is checkmated") return { label: "White wins", whitePercent: 100, known: true };
  return { label: "No saved eval", whitePercent: 50, known: false };
}
