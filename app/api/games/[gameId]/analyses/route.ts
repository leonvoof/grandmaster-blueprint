import { privateRouteDisabled } from "@/lib/site-mode";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AnalysisValidationError, listGameAnalyses, savePositionAnalysis } from "@/lib/game-analysis";

export const runtime = "nodejs";
type Context = { params: Promise<{ gameId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const { gameId } = await params;
  try {
    if (!await prisma.chessGame.findUnique({ where: { id: gameId }, select: { id: true } })) {
      return NextResponse.json({ error: "Saved game not found." }, { status: 404 });
    }
    return NextResponse.json({ analyses: await listGameAnalyses(gameId) });
  } catch {
    return NextResponse.json({ error: "Could not retrieve saved analysis." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const { gameId } = await params;
  const body: unknown = await request.json().catch(() => null);
  try {
    if (!await prisma.chessGame.findUnique({ where: { id: gameId }, select: { id: true } })) {
      return NextResponse.json({ error: "Saved game not found." }, { status: 404 });
    }
    const analysis = await savePositionAnalysis(gameId, body);
    return NextResponse.json({ analysis }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save analysis.";
    const status = message === "Saved game not found." ? 404 : error instanceof AnalysisValidationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
