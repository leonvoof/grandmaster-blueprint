import { Chess } from "chess.js";
import puzzleRows from "./public-puzzles.json" with { type: "json" };
import { puzzleDifficultyOptions, puzzleThemeOptions, type PuzzleDifficulty, type PuzzleTheme } from "./tactics.ts";

export const progressKey = "knightforge:public-progress:v1";
export const maxBackupBytes = 4_000_000;
export const maxPgnLength = 16_000;
export const maxGames = 200;
export const maxTacticsAttempts = 500;
export const puzzles = puzzleRows;

export type PublicGame = { pgn: string; name: string; kind: "game" | "opening"; source?: "lichess"; sourceId?: string; sourceUsername?: string };
export type TacticsAttempt = {
  id: string; puzzleId: string; timestamp: string; difficulty: PuzzleDifficulty; theme: PuzzleTheme;
  solved: boolean; incorrectMove: boolean; skipped: boolean; rating: number | null;
};
export type TacticsTotals = { attempted: number; solved: number; cleanSolved: number; currentCleanStreak: number; bestCleanStreak: number };
export type PublicProgress = { version: 1; games: PublicGame[]; solves: Record<string, number>; recalls: number; tacticsAttempts: TacticsAttempt[]; tacticsTotals: TacticsTotals };
const emptyTacticsTotals = (): TacticsTotals => ({ attempted: 0, solved: 0, cleanSolved: 0, currentCleanStreak: 0, bestCleanStreak: 0 });
const empty = (): PublicProgress => ({ version: 1, games: [], solves: {}, recalls: 0, tacticsAttempts: [], tacticsTotals: emptyTacticsTotals() });
const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const difficulties = new Set<string>(puzzleDifficultyOptions.map(({ value }) => value));
const themes = new Set<string>(puzzleThemeOptions.map(({ value }) => value));

export function validatedPgn(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > maxPgnLength) throw new Error("Use a single PGN under 16,000 characters.");
  const chess = new Chess();
  chess.loadPgn(value);
  if (!chess.history().length || chess.history().length > 600) throw new Error("Use a PGN with 1–600 half-moves.");
  return chess;
}

export function decodeProgress(json: string): PublicProgress {
  if (new TextEncoder().encode(json).length > maxBackupBytes) throw new Error("Backup exceeds the 4 MB limit.");
  const value: unknown = JSON.parse(json);
  if (!record(value) || value.version !== 1 || !Array.isArray(value.games) || value.games.length > maxGames
    || !count(value.recalls) || !record(value.solves)) throw new Error("Invalid KnightForge backup.");
  const games = value.games.map((game: unknown): PublicGame => {
    if (!record(game) || (game.kind !== "game" && game.kind !== "opening") || typeof game.name !== "string"
      || !game.name.trim() || game.name.length > 100 || typeof game.pgn !== "string") throw new Error("Invalid saved PGN entry.");
    validatedPgn(game.pgn);
    if (game.source !== undefined && game.source !== "lichess") throw new Error("Invalid saved game source.");
    if (game.sourceId !== undefined && (typeof game.sourceId !== "string" || !/^[a-zA-Z0-9]{8}$/.test(game.sourceId))) throw new Error("Invalid Lichess game ID.");
    if (game.sourceUsername !== undefined && (typeof game.sourceUsername !== "string" || !/^[a-zA-Z0-9_-]{2,30}$/.test(game.sourceUsername))) throw new Error("Invalid Lichess username.");
    return {
      kind: game.kind, name: game.name, pgn: game.pgn,
      ...(game.source === "lichess" && { source: "lichess" }),
      ...(typeof game.sourceId === "string" && { sourceId: game.sourceId }),
      ...(typeof game.sourceUsername === "string" && { sourceUsername: game.sourceUsername }),
    };
  });
  const solves: Record<string, number> = {};
  for (const [id, total] of Object.entries(value.solves)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !count(total)) throw new Error("Invalid puzzle progress.");
    solves[id] = total;
  }
  let tacticsAttempts: TacticsAttempt[] = [];
  let tacticsTotals = emptyTacticsTotals();
  if (value.tacticsAttempts !== undefined || value.tacticsTotals !== undefined) {
    if (!Array.isArray(value.tacticsAttempts) || value.tacticsAttempts.length > maxTacticsAttempts || !record(value.tacticsTotals)) throw new Error("Invalid Tactics history.");
    tacticsAttempts = value.tacticsAttempts.map((attempt: unknown): TacticsAttempt => {
      if (!record(attempt) || typeof attempt.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(attempt.id)
        || typeof attempt.puzzleId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(attempt.puzzleId)
        || typeof attempt.timestamp !== "string" || !Number.isFinite(Date.parse(attempt.timestamp))
        || typeof attempt.difficulty !== "string" || !difficulties.has(attempt.difficulty)
        || typeof attempt.theme !== "string" || !themes.has(attempt.theme)
        || typeof attempt.solved !== "boolean" || typeof attempt.incorrectMove !== "boolean" || typeof attempt.skipped !== "boolean"
        || (attempt.solved && attempt.skipped)
        || (attempt.rating !== null && (!count(attempt.rating) || attempt.rating > 4000))) throw new Error("Invalid Tactics attempt.");
      return { id: attempt.id, puzzleId: attempt.puzzleId, timestamp: attempt.timestamp, difficulty: attempt.difficulty as PuzzleDifficulty, theme: attempt.theme as PuzzleTheme,
        solved: attempt.solved, incorrectMove: attempt.incorrectMove, skipped: attempt.skipped, rating: attempt.rating as number | null };
    });
    const totals = value.tacticsTotals;
    if (!count(totals.attempted) || !count(totals.solved) || !count(totals.cleanSolved)
      || !count(totals.currentCleanStreak) || !count(totals.bestCleanStreak)
      || totals.cleanSolved > totals.solved || totals.solved > totals.attempted
      || totals.currentCleanStreak > totals.bestCleanStreak || totals.bestCleanStreak > totals.cleanSolved) throw new Error("Invalid Tactics totals.");
    tacticsTotals = { attempted: totals.attempted, solved: totals.solved, cleanSolved: totals.cleanSolved,
      currentCleanStreak: totals.currentCleanStreak, bestCleanStreak: totals.bestCleanStreak };
    if (new Set(tacticsAttempts.map(({ id }) => id)).size !== tacticsAttempts.length) throw new Error("Duplicate Tactics attempt.");
  }
  return { version: 1, games, solves, recalls: value.recalls, tacticsAttempts, tacticsTotals };
}

type StorageAccess = Pick<Storage, "getItem" | "setItem">;

export function readProgress(storage: StorageAccess): PublicProgress {
  const raw = storage.getItem(progressKey);
  return raw === null ? empty() : decodeProgress(raw);
}

export function saveProgress(storage: StorageAccess, state: PublicProgress) {
  const json = JSON.stringify(state);
  const validated = decodeProgress(json);
  storage.setItem(progressKey, JSON.stringify(validated));
  return validated;
}

export function recordTacticsAttempt(state: PublicProgress, attempt: TacticsAttempt): PublicProgress {
  if (state.tacticsAttempts.some(({ id }) => id === attempt.id)) return state;
  const cleanSolve = attempt.solved && !attempt.incorrectMove;
  const currentCleanStreak = cleanSolve ? state.tacticsTotals.currentCleanStreak + 1 : 0;
  const tacticsTotals: TacticsTotals = {
    attempted: state.tacticsTotals.attempted + 1,
    solved: state.tacticsTotals.solved + Number(attempt.solved),
    cleanSolved: state.tacticsTotals.cleanSolved + Number(cleanSolve),
    currentCleanStreak,
    bestCleanStreak: Math.max(state.tacticsTotals.bestCleanStreak, currentCleanStreak),
  };
  return { ...state, tacticsTotals, tacticsAttempts: [...state.tacticsAttempts, attempt].slice(-maxTacticsAttempts) };
}

export function tacticsFirstTryRate(totals: Pick<TacticsTotals, "attempted" | "cleanSolved">): number | null {
  return totals.attempted === 0 ? null : Math.round((totals.cleanSolved / totals.attempted) * 100);
}
