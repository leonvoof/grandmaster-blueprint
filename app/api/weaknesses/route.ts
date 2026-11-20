import { privateRouteDisabled } from "@/lib/site-mode";
import { NextResponse } from "next/server";
import { MAX_DEPTH, MIN_DEPTH } from "@/lib/stockfish/engine";
import { timeControls, type TimeControl } from "@/lib/weakness-analysis";
import { getWeaknessReport } from "@/lib/weakness-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const params = new URL(request.url).searchParams;
  const timeControl = params.get("timeControl") ?? "classical";
  const player = params.get("player")?.trim();
  const rawDepth = params.get("depth");
  const depth = rawDepth === null ? undefined : Number(rawDepth);
  if (!timeControls.includes(timeControl as TimeControl)
    || (depth !== undefined && (!/^\d+$/.test(rawDepth!) || depth < MIN_DEPTH || depth > MAX_DEPTH))
    || (player !== undefined && (!player || player.length > 120))) {
    return NextResponse.json({ error: `Choose a supported timeControl, a player name up to 120 characters, and a depth from ${MIN_DEPTH} to ${MAX_DEPTH}.` }, { status: 400 });
  }
  try {
    const report = await getWeaknessReport({ player, timeControl: timeControl as TimeControl, depth });
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read saved games and analysis." }, { status: 500 });
  }
}
