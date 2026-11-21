import { Chess } from "chess.js";
import { mastersTokenExpired, MastersAuthorizationExpired, requestMastersData, type MastersConnection } from "./public-lichess-masters-auth.ts";

const moveLimit = 12;
const cacheLifetime = 5 * 60_000;
const cacheLimit = 128;
type Counts = [white: number, draws: number, black: number];
export type MastersStats = { games: number; moves: { san: string; games: number; frequency: number; results: Counts | null }[] };

export function mastersPositionKey(fen: string) {
  // Chess.js normalizes the en passant square and preserves castling rights and turn.
  return new Chess(fen).fen().split(" ").slice(0, 4).join(" ");
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function readCounts(value: Record<string, unknown>): Counts | null {
  const { white, draws, black } = value;
  return count(white) && count(draws) && count(black) && Number.isSafeInteger(white + draws + black) ? [white, draws, black] : null;
}
const sum = (counts: Counts) => counts[0] + counts[1] + counts[2];
export const formatMastersPercent = (value: number) => `${value.toFixed(1)}%`;

export function parseMastersStats(input: unknown, fen: string): MastersStats {
  const invalid = () => new Error("The Masters database returned unexpected data.");
  if (!object(input) || !Array.isArray(input.moves) || input.moves.length > moveLimit || !Array.isArray(input.topGames)) throw invalid();
  const totals = readCounts(input);
  if (!totals) throw invalid();
  const games = sum(totals);

  const legal = new Map<string, string>();
  for (const move of new Chess(fen).moves({ verbose: true })) {
    legal.set(move.from + move.to + (move.promotion ?? ""), move.san);
    // Accept the king-to-rook UCI encoding also used by Lichess for castling.
    if (move.isKingsideCastle()) legal.set(move.from + "h" + move.from[1], move.san);
    if (move.isQueensideCastle()) legal.set(move.from + "a" + move.from[1], move.san);
  }
  const seen = new Set<string>();
  const included: Counts = [0, 0, 0];
  const moves = input.moves.map((entry: unknown) => {
    if (!object(entry) || typeof entry.uci !== "string" || typeof entry.san !== "string"
      || legal.get(entry.uci) !== entry.san || seen.has(entry.san)) throw invalid();
    const counts = readCounts(entry);
    if (!counts) throw invalid();
    counts.forEach((result, index) => { included[index] += result; });
    if (included.some((result, index) => result > totals[index])) throw invalid();
    seen.add(entry.san);
    const played = sum(counts);
    return {
      san: entry.san, games: played, frequency: games ? played / games * 100 : 0,
      results: played ? [counts[0] / played * 100, counts[1] / played * 100, counts[2] / played * 100] as Counts : null,
    };
  });
  return { games, moves };
}

export function createMastersStatsLoader(connection: MastersConnection, fetcher = fetch, now = Date.now) {
  const cache = new Map<string, { data: MastersStats; expiresAt: number }>();
  let active: { key: string; result: Promise<MastersStats> } | undefined;
  let rejected = false;
  const lifetime = new AbortController();
  async function load(fen: string, signal: AbortSignal): Promise<MastersStats> {
    const key = `${mastersPositionKey(fen)}|moves=${moveLimit}|topGames=0`;
    while (true) {
      signal.throwIfAborted();
      lifetime.signal.throwIfAborted();
      if (rejected || mastersTokenExpired(connection, now())) throw new MastersAuthorizationExpired();
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) return cached.data;
      if (!active) break;
      if (active.key === key) return active.result;
      // Let the active request finish. Superseded callers bail out before sending another.
      await active.result.catch(() => {});
    }
    const result = requestMastersData(connection, fen, moveLimit, lifetime.signal, fetcher, now)
      .then((value) => {
        const data = parseMastersStats(value, fen);
        cache.delete(key);
        cache.set(key, { data, expiresAt: now() + cacheLifetime });
        if (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
        return data;
      })
      .catch((error: unknown) => {
        if (error instanceof MastersAuthorizationExpired) rejected = true;
        throw error;
      })
      .finally(() => { active = undefined; });
    active = { key, result };
    return result;
  }
  return { load, cancel: () => lifetime.abort() };
}
export type MastersStatsLoader = ReturnType<typeof createMastersStatsLoader>;
