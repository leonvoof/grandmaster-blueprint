import { Chess, type Move } from "chess.js";

export type ExplorerSource = "personal" | "lichess" | "masters";
export type ExplorerFilter = { speeds?: string; ratings?: string; since?: string; until?: string };
export type ExplorerGame = { id: string; pgn: string; opening: string | null; result?: string | null; fingerprint?: string | null };
export type RepertoireLine = { pgn: string; repertoireId: string; chapterId: string; repertoireName: string; chapterName: string; lineName: string };
export type RepertoireMoveRef = { repertoireId: string; chapterId: string; repertoireName: string; chapterName: string; lineName: string };
export type ExplorerMove = { uci: string; san: string; games: number; white: number; draws: number; black: number; frequency: number; openingName: string | null; averageRating?: number | null };
export type ExplorerStats = { source: ExplorerSource; sourceLabel: string; totalGames: number; white: number; draws: number; black: number; openingName: string | null; moves: ExplorerMove[]; repertoireMoves: { uci: string; san: string; lines: RepertoireMoveRef[] }[] };

const positionKey = (fen: string) => fen.trim().split(/\s+/).slice(0, 4).join(" ");
const uci = (move: Pick<Move, "from" | "to" | "promotion">) => `${move.from}${move.to}${move.promotion ?? ""}`;
const normalizedPgnKey = (pgn: string) => pgn.replace(/\s+/g, " ").trim();

export function validateExplorerFen(fen: string) {
  if (typeof fen !== "string" || fen.length > 200) return null;
  try { return new Chess(fen).fen(); } catch { return null; }
}

export function buildPersonalExplorerStats(fen: string, games: readonly ExplorerGame[]): ExplorerStats {
  const target = positionKey(fen);
  const seenGames = new Set<string>();
  const candidates = new Map<string, { san: string; games: number; white: number; draws: number; black: number; openings: Map<string, number> }>();
  let totalGames = 0;
  let white = 0; let draws = 0; let black = 0;
  const openingFrequency = new Map<string, number>();

  for (const game of games) {
    const gameKey = game.fingerprint || normalizedPgnKey(game.pgn);
    if (seenGames.has(gameKey)) continue;
    seenGames.add(gameKey);
    try {
      const chess = new Chess(); chess.loadPgn(game.pgn);
      const history = chess.history({ verbose: true });
      const found = history.find((move) => positionKey(move.before) === target);
      if (!found) continue;
      totalGames++;
      const outcome = game.result || chess.getHeaders().Result;
      if (outcome === "1-0") white++;
      else if (outcome === "0-1") black++;
      else if (outcome === "1/2-1/2") draws++;
      if (game.opening) openingFrequency.set(game.opening, (openingFrequency.get(game.opening) ?? 0) + 1);
      const key = uci(found);
      const item = candidates.get(key) ?? { san: found.san, games: 0, white: 0, draws: 0, black: 0, openings: new Map<string, number>() };
      item.games++;
      if (outcome === "1-0") item.white++;
      else if (outcome === "0-1") item.black++;
      else if (outcome === "1/2-1/2") item.draws++;
      if (game.opening) item.openings.set(game.opening, (item.openings.get(game.opening) ?? 0) + 1);
      candidates.set(key, item);
    } catch { /* Invalid legacy PGNs are excluded, not represented as data. */ }
  }

  const mostCommon = (counts: Map<string, number>) => [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return {
    source: "personal", sourceLabel: "My saved games and imported PGNs", totalGames, white, draws, black,
    openingName: mostCommon(openingFrequency),
    moves: [...candidates.entries()].map(([move, value]) => ({
      uci: move, san: value.san, games: value.games, white: value.white, draws: value.draws, black: value.black,
      frequency: totalGames ? value.games / totalGames : 0, openingName: mostCommon(value.openings),
    })).sort((a, b) => b.games - a.games || a.san.localeCompare(b.san)),
    repertoireMoves: [],
  };
}

export function buildRepertoireContinuations(fen: string, lines: readonly RepertoireLine[]) {
  const target = positionKey(fen);
  const choices = new Map<string, { uci: string; san: string; lines: Map<string, RepertoireMoveRef> }>();
  for (const line of lines) {
    try {
      const chess = new Chess(); chess.loadPgn(line.pgn);
      for (const move of chess.history({ verbose: true })) {
        if (positionKey(move.before) !== target) continue;
        const key = uci(move);
        const choice = choices.get(key) ?? { uci: key, san: move.san, lines: new Map<string, RepertoireMoveRef>() };
        const lineKey = `${line.repertoireId}:${line.chapterId}:${line.lineName}`;
        choice.lines.set(lineKey, { repertoireId: line.repertoireId, chapterId: line.chapterId, repertoireName: line.repertoireName, chapterName: line.chapterName, lineName: line.lineName });
        choices.set(key, choice);
      }
    } catch { /* Invalid saved lines do not become suggested repertoire moves. */ }
  }
  return [...choices.values()].map((choice) => ({ ...choice, lines: [...choice.lines.values()] }));
}

export function validateExplorerMoves(fen: string, rawMoves: unknown): ExplorerMove[] {
  if (!Array.isArray(rawMoves)) return [];
  const result: ExplorerMove[] = [];
  for (const raw of rawMoves) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.uci !== "string") continue;
    try {
      const chess = new Chess(fen);
      const uciMove = item.uci;
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uciMove)) continue;
      const played = chess.move({ from: uciMove.slice(0, 2).toLowerCase(), to: uciMove.slice(2, 4).toLowerCase(), ...(uciMove[4] ? { promotion: uciMove[4].toLowerCase() } : {}) });
      const games = safeCount(item.white) + safeCount(item.draws) + safeCount(item.black);
      const rawGames = safeCount(item.games);
      result.push({
        uci: uci(played), san: played.san, games: rawGames || games,
        white: safeCount(item.white), draws: safeCount(item.draws), black: safeCount(item.black),
        frequency: 0,
        openingName: isOpening(item.opening) ? item.opening.name : null,
        averageRating: typeof item.averageRating === "number" && Number.isFinite(item.averageRating) ? item.averageRating : null,
      });
    } catch { /* Exclude illegal or malformed database moves. */ }
  }
  return result;
}

export function mergeExplorerMoves(
  fen: string,
  stats: readonly ExplorerMove[],
  repertoireMoves: readonly { uci: string; lines: RepertoireMoveRef[] }[],
) {
  const rows = new Map<string, ExplorerMove & { inRepertoire: boolean; repertoireLines: RepertoireMoveRef[] }>();
  for (const item of stats) {
    try {
      const chess = new Chess(fen);
      const played = chess.move({ from: item.uci.slice(0, 2), to: item.uci.slice(2, 4), ...(item.uci[4] ? { promotion: item.uci[4] } : {}) });
      rows.set(uci(played), { ...item, uci: uci(played), san: played.san, inRepertoire: false, repertoireLines: [] });
    } catch { /* A malformed provider result is never shown as a legal move. */ }
  }
  for (const choice of repertoireMoves) {
    try {
      const chess = new Chess(fen);
      const played = chess.move({ from: choice.uci.slice(0, 2), to: choice.uci.slice(2, 4), ...(choice.uci[4] ? { promotion: choice.uci[4] } : {}) });
      const key = uci(played);
      const existing = rows.get(key);
      rows.set(key, {
        ...(existing ?? { uci: key, san: played.san, games: 0, white: 0, draws: 0, black: 0, frequency: 0, openingName: null, averageRating: null }),
        inRepertoire: true, repertoireLines: choice.lines,
      });
    } catch { /* A stale or malformed repertoire move is excluded. */ }
  }
  return [...rows.values()].sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));
}

const safeCount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const isOpening = (value: unknown): value is { name: string } => Boolean(value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string");

export function normalizeRemoteExplorer(source: "lichess" | "masters", fen: string, payload: unknown): ExplorerStats {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const white = safeCount(body.white); const draws = safeCount(body.draws); const black = safeCount(body.black);
  const totalGames = white + draws + black;
  const moves = validateExplorerMoves(fen, body.moves).map((move) => ({ ...move, frequency: totalGames ? move.games / totalGames : 0 }));
  return {
    source, sourceLabel: source === "lichess" ? "Lichess rated-game database" : "Lichess Masters database",
    totalGames, white, draws, black, openingName: isOpening(body.opening) ? body.opening.name : null,
    moves, repertoireMoves: [],
  };
}

const responseCache = new Map<string, { expires: number; data: ExplorerStats }>();
export function clearExplorerCache() { responseCache.clear(); }

export async function fetchRemoteExplorer(input: {
  source: "lichess" | "masters"; fen: string; filters: ExplorerFilter; token?: string;
  fetcher?: typeof fetch; now?: number;
}): Promise<{ data?: ExplorerStats; status: number; error?: string; retryAfter?: string; cached?: boolean }> {
  if (!input.token?.trim()) return { status: 503, error: "Configure LICHESS_API_TOKEN on the server to use authenticated Lichess opening databases." };
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? Date.now();
  const query = new URLSearchParams({ fen: positionKey(input.fen), moves: "20" });
  if (input.filters.since) query.set("since", input.filters.since);
  if (input.filters.until) query.set("until", input.filters.until);
  if (input.source === "lichess") {
    if (input.filters.speeds) query.set("speeds", input.filters.speeds);
    if (input.filters.ratings) query.set("ratings", input.filters.ratings);
  }
  const cacheKey = `${input.source}|${query.toString()}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > now) return { data: cached.data, status: 200, cached: true };
  try {
    const response = await fetcher(`https://explorer.lichess.org/${input.source}?${query}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${input.token.trim()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { status: response.status, error: "Lichess rejected the configured opening-explorer credential. Check its validity and access." };
      if (response.status === 429) return { status: 429, error: "Lichess rate limit reached. Wait before requesting this database again.", retryAfter: response.headers.get("Retry-After") ?? undefined };
      if (response.status === 400) return { status: 400, error: "Lichess rejected the position or selected filters." };
      return { status: response.status >= 500 ? 502 : response.status, error: "Lichess opening data is temporarily unavailable." };
    }
    const data = normalizeRemoteExplorer(input.source, input.fen, await response.json());
    if (responseCache.size >= 200) responseCache.delete(responseCache.keys().next().value as string);
    responseCache.set(cacheKey, { expires: now + 60_000, data });
    return { data, status: 200, cached: false };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { status: 502, error: timedOut ? "Lichess opening request timed out." : "Could not reach Lichess opening data." };
  }
}
