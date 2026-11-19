import { Chess } from "chess.js";
export const PUZZLE_SOURCE = "Lichess Puzzle Database";
export const PUZZLE_LICENSE = "CC0 1.0 Universal (Public Domain)";
export type PuzzleInput = { id: string; fen: string; moves: string; rating: number; themes: string };
export function parsePuzzleRow(row: PuzzleInput) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(row.id) || !Number.isInteger(row.rating) || row.rating < 0 || row.rating > 4000) throw new Error("Invalid puzzle identity or rating.");
  const moves = row.moves.trim().split(/\s+/);
  if (moves.length < 2 || moves.some((move) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) throw new Error("Puzzle must contain a setup move and a solution line.");
  const chess = new Chess(row.fen);
  chess.move({ from: moves[0].slice(0,2), to: moves[0].slice(2,4), promotion: moves[0][4] });
  const puzzleFen = chess.fen();
  for (const uci of moves.slice(1)) chess.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] });
  return { id: row.id, fen: puzzleFen, solution: JSON.stringify(moves.slice(1)), rating: row.rating, themes: JSON.stringify(row.themes.trim().split(/\s+/).filter(Boolean)), moveCount: Math.ceil((moves.length - 1) / 2), source: PUZZLE_SOURCE, license: PUZZLE_LICENSE };
}
export function selectPuzzleQuery(input: { minRating?: number; maxRating?: number; theme?: string; failed?: boolean; unattempted?: boolean }) {
  const where: Record<string, unknown> = { rating: { gte: input.minRating ?? 0, lte: input.maxRating ?? 4000 } };
  if (input.theme) where.themes = { contains: `"${input.theme}"` };
  if (input.failed) where.attempts = { some: { firstAttemptCorrect: false } };
  if (input.unattempted) where.attempts = { none: {} };
  return where;
}
