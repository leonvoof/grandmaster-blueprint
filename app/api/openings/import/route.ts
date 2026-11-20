import { privateRouteDisabled } from "@/lib/site-mode";
import { NextResponse } from "next/server";
import { importOpeningPgn } from "@/lib/opening-import";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.repertoireId !== "string" || typeof body.pgn !== "string" || !body.pgn.trim()) return NextResponse.json({ error: "Choose a repertoire and provide PGN." }, { status: 400 });
  try { return NextResponse.json(await importOpeningPgn(body.repertoireId, body.pgn)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "PGN import failed. No chapters were added." }, { status: 400 }); }
}
