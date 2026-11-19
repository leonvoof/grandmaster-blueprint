import { Chess, type Square } from "chess.js";

export type Score = { kind: "cp" | "mate"; value: number };
export type Terminal = "White is checkmated" | "Black is checkmated" | "Stalemate" | "Insufficient material" | "75-move rule";
export type Analysis = {
  engine: string;
  depth: number;
  score: Score | null;
  bestMove: string | null;
  variation: string[];
  terminal?: Terminal;
};

const castling = [
  ["K", "e1", "h1", "w"], ["Q", "e1", "a1", "w"],
  ["k", "e8", "h8", "b"], ["q", "e8", "a8", "b"],
] as const;

export function analysisPosition(fen: string) {
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6 || !fields.slice(4).every((field) => /^\d{1,6}$/.test(field))) {
    throw new Error("Enter a valid FEN with all six fields.");
  }
  let chess: Chess;
  try {
    chess = new Chess(fields.join(" "));
  } catch {
    throw new Error("Enter a valid FEN with all six fields.");
  }

  const pieces = chess.board().flat().filter((piece) => piece !== null);
  const lastPlayer = chess.turn() === "w" ? "b" : "w";
  const lastKing = pieces.find((piece) => piece.type === "k" && piece.color === lastPlayer);
  const invalidMaterial = (["w", "b"] as const).some((color) => {
    const side = pieces.filter((piece) => piece.color === color);
    return side.length > 16 || side.filter((piece) => piece.type === "p").length > 8;
  });
  const invalidCastling = castling.some(([right, king, rook, color]) => (
    fields[2].includes(right) && (
      chess.get(king)?.type !== "k" || chess.get(king)?.color !== color
      || chess.get(rook)?.type !== "r" || chess.get(rook)?.color !== color
    )
  ));
  const target = fields[3];
  const pawnRank = lastPlayer === "w" ? "4" : "5";
  const pawn = chess.get(`${target[0]}${pawnRank}` as Square);
  const origin = `${target[0]}${lastPlayer === "w" ? "2" : "7"}` as Square;
  const invalidEnPassant = target !== "-" && (
    pawn?.type !== "p" || pawn.color !== lastPlayer || chess.get(target as Square) || chess.get(origin)
  );
  if (!lastKing || chess.isAttacked(lastKing.square, chess.turn()) || invalidMaterial || invalidCastling || invalidEnPassant) {
    throw new Error("This FEN describes an illegal chess position.");
  }

  let terminal: Terminal | undefined;
  if (chess.isCheckmate()) terminal = chess.turn() === "w" ? "White is checkmated" : "Black is checkmated";
  else if (chess.isStalemate()) terminal = "Stalemate";
  else if (chess.isInsufficientMaterial()) terminal = "Insufficient material";
  else if (Number(fields[4]) >= 150) terminal = "75-move rule";
  return { chess, terminal };
}

export function uciVariationToSan(fen: string, variation: string[]) {
  const chess = new Chess(fen);
  return variation.map((move) => {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw new Error("Stockfish returned an invalid move.");
    return chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] }).san;
  });
}

export function parseUciInfo(line: string, whiteToMove: boolean) {
  if (!line.startsWith("info depth ")) return null;
  const depth = Number(line.match(/^info depth (\d+)\b/)?.[1]);
  const score = line.match(/\bscore (cp|mate) (-?\d+)(?=\s|$)/);
  const pv = line.match(/\bpv (.+)$/);
  const multiPv = line.match(/\bmultipv (\d+)/)?.[1];
  if (!Number.isSafeInteger(depth) || !score || !pv || (multiPv && multiPv !== "1") || /\b(?:lowerbound|upperbound)\b/.test(line)) return null;
  const value = Number(score[2]);
  if (!Number.isSafeInteger(value)) return null;
  return {
    depth,
    score: { kind: score[1] as Score["kind"], value: value === 0 || whiteToMove ? value : -value },
    moves: pv[1].trim().split(/\s+/),
  };
}
