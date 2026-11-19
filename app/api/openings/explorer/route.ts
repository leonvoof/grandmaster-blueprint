import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadPersonalExplorerData, loadRepertoireExplorerMoves } from "@/lib/opening-explorer-db";
import {
  fetchRemoteExplorer,
  validateExplorerFen, type ExplorerFilter, type ExplorerSource,
} from "@/lib/opening-explorer";

export const runtime = "nodejs";
const sources: ExplorerSource[] = ["personal", "lichess", "masters"];
const speeds = ["ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"];
const ratingGroups = ["0", "1000", "1200", "1400", "1600", "1800", "2000", "2200", "2500"];
const monthValue = (value: string) => /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(value);

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const source = query.get("source") as ExplorerSource | null;
  const fen = validateExplorerFen(query.get("fen") ?? "");
  if (!source || !sources.includes(source)) return NextResponse.json({ error: "Choose personal, Lichess, or Masters data." }, { status: 400 });
  if (!fen) return NextResponse.json({ error: "Enter a valid chess position FEN." }, { status: 400 });

  const since = query.get("since") ?? "";
  const until = query.get("until") ?? "";
  const speed = query.get("speed") ?? "";
  const ratingFrom = query.get("ratingFrom") ?? "";
  const ratingUntil = query.get("ratingUntil") ?? "";
  if ((since && !monthValue(since)) || (until && !monthValue(until))) return NextResponse.json({ error: "Date filters must use YYYY or YYYY-MM." }, { status: 400 });
  const sinceMonth = since.length === 4 ? `${since}-01` : since;
  const untilMonth = until.length === 4 ? `${until}-12` : until;
  if (sinceMonth && untilMonth && sinceMonth > untilMonth) return NextResponse.json({ error: "Start date must be before the end date." }, { status: 400 });
  if (source === "masters" && (speed || ratingFrom || ratingUntil)) return NextResponse.json({ error: "Time-control and rating filters are unavailable for the Masters source." }, { status: 400 });
  if (source !== "masters" && speed && !speeds.includes(speed)) return NextResponse.json({ error: "Choose a supported time control." }, { status: 400 });
  if (source === "lichess" && ((ratingFrom && !ratingGroups.includes(ratingFrom)) || (ratingUntil && !ratingGroups.includes(ratingUntil)))) return NextResponse.json({ error: "Choose a supported Lichess rating group." }, { status: 400 });

  const filters: ExplorerFilter = { ...(since && { since }), ...(until && { until }) };
  if (source === "lichess") {
    if (speed) filters.speeds = speed;
    const first = ratingGroups.indexOf(ratingFrom || "0");
    const last = ratingUntil ? ratingGroups.indexOf(ratingUntil) : ratingGroups.length;
    if (ratingUntil && last <= first) return NextResponse.json({ error: "The upper rating boundary must be higher than the lower boundary." }, { status: 400 });
    if (ratingFrom || ratingUntil) filters.ratings = ratingGroups.slice(first, last).join(",");
  }

  try {
    if (source !== "personal") {
      const result = await fetchRemoteExplorer({ source, fen, filters, token: process.env.LICHESS_API_TOKEN });
      if (!result.data) return NextResponse.json({ error: result.error }, { status: result.status, headers: result.retryAfter ? { "Retry-After": result.retryAfter } : {} });
      const repertoireMoves = await loadRepertoireExplorerMoves(prisma, fen);
      return NextResponse.json({ ...result.data, fen, cached: result.cached ?? false, filters, repertoireMoves }, { headers: { "Cache-Control": "no-store" } });
    }
    if (ratingFrom || ratingUntil) {
      return NextResponse.json({ error: "Rating filters are unavailable for personal saved games." }, { status: 400 });
    }
    const data = await loadPersonalExplorerData(prisma, fen, { since, until, speed });
    return NextResponse.json({ ...data, fen, filters: { since, until, speed }, cache: "live local database" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load opening explorer data." }, { status: 500 });
  }
}
