import { Chess } from "chess.js";
import puzzleRows from "./public-puzzles.json" with { type: "json" };

export const progressKey = "knightforge:public-progress:v1";
export const maxBackupBytes = 4_000_000;
export const maxPgnLength = 16_000;
export const maxGames = 200;
export const puzzles = puzzleRows;

export type PublicGame = { pgn: string; name: string; kind: "game" | "opening"; source?: "lichess"; sourceId?: string; sourceUsername?: string };
export type PublicProgress = { version: 1; games: PublicGame[]; solves: Record<string, number>; recalls: number };
const empty = (): PublicProgress => ({ version: 1, games: [], solves: {}, recalls: 0 });
const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const puzzleIds = new Set(puzzles.map(({ id }) => id));

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
    if (!puzzleIds.has(id) || !count(total)) throw new Error("Invalid puzzle progress.");
    solves[id] = total;
  }
  return { version: 1, games, solves, recalls: value.recalls };
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
