import { Chess } from "chess.js";
import { maxGames, maxPgnLength, type PublicGame } from "./public-progress.ts";

export type LichessTimeControl = "all" | "classical" | "rapid" | "blitz";
export const lichessImportLimits = [10, 25, 50, 100] as const;
export const lichessCooldownKey = "knightforge:lichess-cooldown-until:v1";
export const lichessImportLockName = "knightforge:public-lichess-game-import";
export const maxLichessResponseBytes = 4_000_000;
const allTimeControls = ["ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"];
const lichessIdPattern = /^\s*\[Site\s+"https:\/\/lichess\.org\/(?:game\/)?([a-zA-Z0-9]{8})(?:\/(?:white|black))?"\s*\]/m;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type CandidateGame = PublicGame & { source: "lichess"; sourceUsername: string };
export class LichessImportError extends Error {
  readonly code: "invalid-username" | "busy" | "cooldown" | "not-found" | "rate-limited" | "response" | "too-large" | "network" | "http";
  readonly retryAt?: number;
  constructor(code: LichessImportError["code"], message: string, retryAt?: number) {
    super(message);
    this.name = "LichessImportError";
    this.code = code;
    this.retryAt = retryAt;
  }
}

export function validatePublicLichessUsername(value: string) {
  const username = value.trim();
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(username)) {
    throw new LichessImportError("invalid-username", "Enter a Lichess username with 2–30 letters, numbers, underscores, or hyphens.");
  }
  return username;
}

export function buildLichessExportUrl(usernameInput: string, timeControl: LichessTimeControl, limit: number) {
  const username = validatePublicLichessUsername(usernameInput);
  if (!(lichessImportLimits as readonly number[]).includes(limit)) throw new Error("Choose an import limit of 10, 25, 50, or 100 games.");
  const url = new URL(`https://lichess.org/api/games/user/${encodeURIComponent(username)}`);
  url.searchParams.set("max", String(limit));
  url.searchParams.set("sort", "dateDesc");
  url.searchParams.set("finished", "true");
  url.searchParams.set("ongoing", "false");
  url.searchParams.set("opening", "true");
  url.searchParams.set("clocks", "true");
  if (timeControl === "all") url.searchParams.set("perfType", allTimeControls.join(","));
  else if (timeControl === "classical" || timeControl === "rapid" || timeControl === "blitz") url.searchParams.set("perfType", timeControl);
  else throw new Error("Unsupported time control.");
  return url;
}

export function splitLichessPgnExport(text: string) {
  const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!cleaned) return [];
  const events = [...cleaned.matchAll(/^\[Event\s+"(?:\\.|[^"])*"\]\s*$/gm)];
  if (!events.length) return [cleaned];
  const chunks: string[] = [];
  const prefix = cleaned.slice(0, events[0].index).trim();
  if (prefix) chunks.push(prefix);
  for (let index = 0; index < events.length; index++) {
    const start = events[index].index!;
    const end = index + 1 < events.length ? events[index + 1].index! : cleaned.length;
    const pgn = cleaned.slice(start, end).trim();
    if (pgn) chunks.push(pgn);
  }
  return chunks;
}

function displayName(chess: Chess, username: string) {
  const headers = chess.getHeaders();
  const white = headers.White?.trim() || "White";
  const black = headers.Black?.trim() || "Black";
  const date = headers.UTCDate && headers.UTCDate !== "????.??.??" ? headers.UTCDate.replaceAll(".", "-") : headers.Date && headers.Date !== "????.??.??" ? headers.Date.replaceAll(".", "-") : "";
  const opening = headers.Opening?.trim();
  return `${opening ? `${opening} · ` : ""}${white} vs ${black}${date ? ` · ${date}` : ""}`.slice(0, 100) || `Lichess game · ${username}`;
}

function getLichessGameId(pgn: string) {
  return pgn.match(lichessIdPattern)?.[1];
}

export function parseLichessPgnExport(text: string, usernameInput: string, limit: number) {
  const username = validatePublicLichessUsername(usernameInput);
  const chunks = splitLichessPgnExport(text);
  const overLimit = Math.max(0, chunks.length - limit);
  let invalid = 0;
  const games: CandidateGame[] = [];
  for (const pgn of chunks.slice(0, limit)) {
    if (pgn.length > maxPgnLength) { invalid++; continue; }
    try {
      const chess = new Chess();
      chess.loadPgn(pgn);
      const moves = chess.history();
      if (!moves.length || moves.length > 600) { invalid++; continue; }
      const id = getLichessGameId(pgn);
      games.push({
        pgn,
        name: displayName(chess, username),
        kind: "game",
        source: "lichess",
        sourceUsername: username,
        ...(id && { sourceId: id }),
      });
    } catch { invalid++; }
  }
  return { games, invalid, total: Math.min(chunks.length, limit), overLimit };
}

function fingerprint(pgn: string) {
  return pgn.replace(/\s+/g, " ").trim();
}

export function mergeLichessGames(existing: PublicGame[], incoming: CandidateGame[]) {
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  for (const game of existing) {
    const id = game.sourceId ?? getLichessGameId(game.pgn);
    if (id) ids.add(id);
    fingerprints.add(fingerprint(game.pgn));
  }
  const added: CandidateGame[] = [];
  let duplicates = 0;
  for (const game of incoming) {
    const id = game.sourceId ?? getLichessGameId(game.pgn);
    const normalized = fingerprint(game.pgn);
    if ((id && ids.has(id)) || fingerprints.has(normalized)) { duplicates++; continue; }
    if (id) ids.add(id);
    fingerprints.add(normalized);
    added.push(game);
  }
  const available = Math.max(0, maxGames - existing.length);
  const saved = added.slice(0, available);
  return { games: [...existing, ...saved], imported: saved.length, duplicates, capacitySkipped: added.length - saved.length };
}

export function getLichessCooldown(storage: StorageLike, now = Date.now()) {
  const value = Number(storage.getItem(lichessCooldownKey));
  return Number.isFinite(value) && value > now ? value : 0;
}

async function readLimitedText(response: Response, onBytes?: (bytes: number) => void) {
  if (!response.body) {
    const text = await response.text();
    const size = new TextEncoder().encode(text).byteLength;
    if (size > maxLichessResponseBytes) throw new LichessImportError("too-large", "Lichess export exceeded the 4 MB safety limit. Choose a smaller import limit.");
    onBytes?.(size);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxLichessResponseBytes) {
        await reader.cancel();
        throw new LichessImportError("too-large", "Lichess export exceeded the 4 MB safety limit. Choose a smaller import limit.");
      }
      text += decoder.decode(part.value, { stream: true });
      onBytes?.(bytes);
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

let fallbackRequestActive = false;
export async function withSingleLichessImport<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(lichessImportLockName, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) throw new LichessImportError("busy", "Another Lichess import is already running in this browser.");
      return operation();
    });
  }
  if (fallbackRequestActive) throw new LichessImportError("busy", "Another Lichess import is already running in this tab.");
  fallbackRequestActive = true;
  try { return await operation(); }
  finally { fallbackRequestActive = false; }
}

export async function requestPublicLichessGames(options: {
  username: string;
  timeControl: LichessTimeControl;
  limit: number;
  storage: StorageLike;
  existing: PublicGame[];
  fetcher?: typeof fetch;
  now?: () => number;
  onProgress?: (bytes: number) => void;
}) {
  const url = buildLichessExportUrl(options.username, options.timeControl, options.limit);
  const now = options.now?.() ?? Date.now();
  const cooldown = getLichessCooldown(options.storage, now);
  if (cooldown) throw new LichessImportError("cooldown", "Lichess asked this browser to wait before another request.", cooldown);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, {
      method: "GET",
      headers: { Accept: "application/x-chess-pgn" },
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new LichessImportError("network", "Could not reach Lichess from this browser. The network or browser CORS policy may be blocking the request. You can still download a PGN from Lichess and import it below.");
  }
  if (response.status === 429) {
    const retryAt = now + 60_000;
    options.storage.setItem(lichessCooldownKey, String(retryAt));
    throw new LichessImportError("rate-limited", "Lichess rate-limited this browser. Wait at least one minute before trying again.", retryAt);
  }
  if (response.status === 404) throw new LichessImportError("not-found", "No public games were found for that Lichess username, or the account is unavailable.");
  if (!response.ok) throw new LichessImportError("http", `Lichess returned HTTP ${response.status}. Please try again later.`);
  const type = response.headers.get("content-type") ?? "";
  if (type && !type.toLowerCase().includes("application/x-chess-pgn") && !type.toLowerCase().includes("text/plain")) {
    throw new LichessImportError("response", "Lichess returned an unexpected response format. No games were saved.");
  }
  const text = await readLimitedText(response, options.onProgress);
  const parsed = parseLichessPgnExport(text, options.username, options.limit);
  const merged = mergeLichessGames(options.existing, parsed.games);
  return { ...parsed, candidates: parsed.games, ...merged, returned: parsed.total };
}
