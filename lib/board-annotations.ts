export type BoardOrientation = "white" | "black";

const annotations = {
  Brilliant: { symbol: "!!", color: "#53dbc5", tone: "vivid" },
  Great: { symbol: "!", color: "#6da7ff", tone: "vivid" },
  Best: { symbol: "★", color: "#77dc8e", tone: "vivid" },
  Excellent: { symbol: "✓", color: "#a8d69d", tone: "subtle" },
  Good: { symbol: "·", color: "#8db99a", tone: "subtle" },
  Inaccuracy: { symbol: "?!", color: "#f1d15c", tone: "vivid" },
  Mistake: { symbol: "?", color: "#f29a54", tone: "vivid" },
  Blunder: { symbol: "??", color: "#f16f75", tone: "vivid" },
} as const;

export type BoardMoveClassification = keyof typeof annotations;

export function boardMoveAnnotation(classification: string | null | undefined) {
  if (!classification || !Object.hasOwn(annotations, classification)) return null;
  return annotations[classification as BoardMoveClassification];
}

export function boardSquareCell(square: string, orientation: BoardOrientation) {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return orientation === "white"
    ? { column: file, row: 8 - rank }
    : { column: 7 - file, row: rank - 1 };
}
