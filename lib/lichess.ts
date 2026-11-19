import { saveLichessGame } from "@/lib/games";
import { parsePgnCollection } from "@/lib/pgn";

export const speeds = ["classical", "rapid", "blitz"] as const;
export const limits = [10, 25, 50, 100] as const;
type Speed = typeof speeds[number];
type Limit = typeof limits[number];
type Ratings = { [key in Speed]: number | null };
export type SyncCounts = { imported: number; skipped: number; failed: number };

export class LichessError extends Error {
  readonly status: number;
  readonly retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function parseUsername(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{2,30}$/i.test(value.trim())) {
    throw new LichessError("Enter a valid Lichess username using letters, numbers, underscores or hyphens.", 400);
  }
  return value.trim().toLowerCase();
}

const globalState = globalThis as typeof globalThis & {
  lichessRequestState?: { busy: boolean; retryAt: number };
};
const requestState = globalState.lichessRequestState ??= { busy: false, retryAt: 0 };

async function withLichess<T>(path: string, accept: string, consume: (response: Response) => Promise<T>): Promise<T> {
  const remaining = requestState.retryAt - Date.now();
  if (remaining > 0) {
    throw new LichessError("Lichess rate limit. Wait before trying again.", 429, Math.ceil(remaining / 1000));
  }
  if (requestState.busy) throw new LichessError("A Lichess request is already running. Try again when it finishes.", 409);
  requestState.busy = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    let response: Response;
    try {
      response = await fetch(`https://lichess.org${path}`, {
        headers: { Accept: accept, "User-Agent": "Grandmaster Blueprint" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new LichessError("Could not reach Lichess. Check your connection and try again.", 502);
    }

    if (response.status === 429) {
      const header = response.headers.get("retry-after");
      const delay = header && /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header ?? "") - Date.now();
      const wait = Math.max(60_000, Number.isFinite(delay) ? delay : 0);
      requestState.retryAt = Date.now() + wait;
      throw new LichessError("Lichess rate limit. Wait before trying again.", 429, Math.ceil(wait / 1000));
    }
    if ([401, 403, 404, 410].includes(response.status)) {
      throw new LichessError("That Lichess account or its public data is unavailable. Check the username.", 404);
    }
    if (!response.ok) throw new LichessError("Lichess is temporarily unavailable. Try again later.", 502);
    return await consume(response);
  } finally {
    controller.abort();
    clearTimeout(timer);
    requestState.busy = false;
  }
}

export async function lookupLichessUser(username: string) {
  return withLichess(`/api/user/${encodeURIComponent(username)}?profile=false`, "application/json", async (response) => {
    const user = await response.json().catch(() => null);
    if (user?.disabled) throw new LichessError("This Lichess account is unavailable.", 404);
    if (typeof user?.username !== "string") throw new LichessError("Lichess returned an unreadable profile.", 502);
    const ratings = Object.fromEntries(speeds.map((speed) => [
      speed, Number.isInteger(user.perfs?.[speed]?.rating) ? user.perfs[speed].rating : null,
    ])) as Ratings;
    return { username: user.username, ...ratings };
  });
}

const finishedStatuses = new Set([
  "mate", "resign", "stalemate", "timeout", "draw", "outoftime", "cheat", "noStart",
  "unknownFinish", "insufficientMaterialClaim", "variantEnd",
]);

export function parseLichessGame(line: string, speed: Speed) {
  const game = JSON.parse(line);
  if (game?.status === "created" || game?.status === "started" || game?.status === "aborted") return null;
  if (!finishedStatuses.has(game?.status) || typeof game.id !== "string"
    || !/^[a-zA-Z0-9]{8}$/.test(game.id) || typeof game.pgn !== "string") {
    throw new Error("Invalid Lichess game");
  }
  if (game.variant !== "standard" || game.speed !== speed) return null;
  const [parsed, ...extra] = parsePgnCollection(game.pgn);
  if (extra.length || !["1-0", "0-1", "1/2-1/2"].includes(parsed.result ?? "")) throw new Error("Invalid finished game PGN");
  const clock = {
    ...(game.clock && { control: game.clock }),
    ...(Array.isArray(game.clocks) && { centiseconds: game.clocks }),
  };
  return {
    ...parsed,
    opening: typeof game.opening?.name === "string" ? game.opening.name : parsed.opening,
    lichessId: game.id,
    lichessSpeed: speed,
    ...(Object.keys(clock).length && { lichessClock: clock }),
  };
}

async function* readLines(response: Response) {
  if (!response.body) throw new LichessError("Lichess returned no game stream.", 502);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const lines = (pending + value).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) yield line;
    }
    if (pending.trim()) yield pending;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function syncLichessGames(
  username: string, speed: Speed, limit: Limit, counts: SyncCounts,
  progress: () => void, save = saveLichessGame,
) {
  const query = new URLSearchParams({
    perfType: speed, max: String(limit), sort: "dateDesc", pgnInJson: "true",
    clocks: "true", opening: "true", ongoing: "false", finished: "true",
  });
  return withLichess(`/api/games/user/${encodeURIComponent(username)}?${query}`, "application/x-ndjson", async (response) => {
    try {
      for await (const line of readLines(response)) {
        try {
          const game = parseLichessGame(line, speed);
          if (game && await save(game)) counts.imported++;
          else counts.skipped++;
        } catch {
          counts.failed++;
        }
        progress();
        if (counts.imported + counts.skipped + counts.failed >= limit) break;
      }
    } catch (error) {
      if (error instanceof LichessError) throw error;
      throw new LichessError("The Lichess game stream was interrupted. Sync again to retry.", 502);
    }
  });
}
