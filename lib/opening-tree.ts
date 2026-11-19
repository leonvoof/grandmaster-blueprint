import { Chess } from "chess.js";

export function lineMoves(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history();
}

export function linePgn(moves: string[], fen?: string) {
  const chess = new Chess(fen);
  if (fen) chess.header("SetUp", "1", "FEN", fen);
  for (const san of moves) chess.move(san);
  return chess.pgn();
}

export function positionForMoves(moves: string[], ply: number, fen?: string) {
  const chess = new Chess(fen);
  for (const san of moves.slice(0, ply)) chess.move(san);
  return chess.fen();
}

export function canonicalLine(pgn: string) {
  return lineMoves(pgn).join(" ");
}

/** Identifies a line together with its starting position, including custom FENs. */
export function lineIdentity(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const fen = chess.getHeaders().FEN;
  const startingPosition = fen ? new Chess(fen).fen() : new Chess().fen();
  return `${startingPosition}::${chess.history().join(" ")}`;
}
