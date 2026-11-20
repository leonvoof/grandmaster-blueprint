import { Chess } from "chess.js";
export const PUZZLE_SOURCE = "Lichess Puzzle Database";
export const PUZZLE_LICENSE = "CC0 1.0 Universal (Public Domain)";
export const puzzleDifficultyOptions = [
  { label: "Very Easy", value: "easiest" },
  { label: "Easy", value: "easier" },
  { label: "Normal", value: "normal" },
  { label: "Hard", value: "harder" },
  { label: "Very Hard", value: "hardest" },
] as const;
export const puzzleThemeOptions = [
  { label: "Mixed", value: "mix" },
  { label: "Forks", value: "fork" },
  { label: "Pins", value: "pin" },
  { label: "Checkmates", value: "mate" },
  { label: "Mate in 1", value: "mateIn1" },
  { label: "Sacrifices", value: "sacrifice" },
  { label: "Endgames", value: "endgame" },
  { label: "Skewers", value: "skewer" },
  { label: "Discovered Attacks", value: "discoveredAttack" },
  { label: "Hanging Pieces", value: "hangingPiece" },
] as const;
export type PuzzleDifficulty = typeof puzzleDifficultyOptions[number]["value"];
export type PuzzleTheme = typeof puzzleThemeOptions[number]["value"];
export function buildPuzzleNextUrl(difficulty: PuzzleDifficulty, angle: PuzzleTheme) {
  const query = new URLSearchParams({ difficulty, angle });
  return `https://lichess.org/api/puzzle/next?${query.toString()}`;
}
export type PuzzleInput = { id: string; fen: string; moves: string; rating: number; themes: string; setupApplied?: boolean };
export function parseNextPuzzle(value: unknown): PuzzleInput {
  if (!value || typeof value !== "object") throw new Error("Lichess returned an invalid puzzle.");
  const data = value as { puzzle?: { id?: unknown; fen?: unknown; lastMove?: unknown; solution?: unknown; rating?: unknown; themes?: unknown } };
  const p = data.puzzle;
  if (!p || typeof p.id !== "string" || typeof p.fen !== "string" || typeof p.lastMove !== "string" || !Array.isArray(p.solution) || !p.solution.every((move) => typeof move === "string") || !Number.isInteger(p.rating) || !Array.isArray(p.themes) || !p.themes.every((theme) => typeof theme === "string")) throw new Error("Lichess returned an invalid puzzle.");
  const row: PuzzleInput = { id: p.id, fen: p.fen, moves: (p.solution as string[]).join(" "), rating: p.rating as number, themes: (p.themes as string[]).join(" "), setupApplied: true };
  parsePuzzleRow(row);
  return row;
}
export function parsePuzzleRow(row: PuzzleInput) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(row.id) || !Number.isInteger(row.rating) || row.rating < 0 || row.rating > 4000) throw new Error("Invalid puzzle identity or rating.");
  const moves = row.moves.trim().split(/\s+/);
  if (moves.length < (row.setupApplied ? 1 : 2) || moves.some((move) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) throw new Error("Puzzle must contain a setup move and a solution line.");
  const chess = new Chess(row.fen);
  if (!row.setupApplied) chess.move({ from: moves[0].slice(0,2), to: moves[0].slice(2,4), promotion: moves[0][4] });
  const puzzleFen = chess.fen();
  const solution = row.setupApplied ? moves : moves.slice(1);
  for (const uci of solution) chess.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] });
  return { id: row.id, fen: puzzleFen, solution: JSON.stringify(solution), rating: row.rating, themes: JSON.stringify(row.themes.trim().split(/\s+/).filter(Boolean)), moveCount: Math.ceil(solution.length / 2), source: PUZZLE_SOURCE, license: PUZZLE_LICENSE };
}
export function selectPuzzleQuery(input: { minRating?: number; maxRating?: number; theme?: string; failed?: boolean; unattempted?: boolean }) {
  const where: Record<string, unknown> = { rating: { gte: input.minRating ?? 0, lte: input.maxRating ?? 4000 } };
  if (input.theme) where.themes = { contains: `"${input.theme}"` };
  if (input.failed) where.attempts = { some: { firstAttemptCorrect: false } };
  if (input.unattempted) where.attempts = { none: {} };
  return where;
}
