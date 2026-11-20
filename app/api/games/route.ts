import { privateRouteDisabled } from "@/lib/site-mode";
import { NextResponse } from "next/server";
import { parsePgnCollection } from "@/lib/pgn";
import { listSavedGames, savePgnGames } from "@/lib/games";

export const runtime = "nodejs";
export async function GET() {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  try { return NextResponse.json({ games: await listSavedGames() }); }
  catch { return NextResponse.json({ error: "Could not load saved games." }, { status: 500 }); }
}
export async function POST(request: Request) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  try {
    const { pgn } = await request.json();
    if (typeof pgn !== "string" || !pgn.trim()) return NextResponse.json({ error: "Paste or upload PGN first." }, { status: 400 });
    const games = parsePgnCollection(pgn);
    await savePgnGames(games);
    return NextResponse.json({ saved: games.length, games: await listSavedGames() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save PGN." }, { status: 400 });
  }
}
