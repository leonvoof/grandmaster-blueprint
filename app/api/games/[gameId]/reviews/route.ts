import { privateRouteDisabled } from "@/lib/site-mode";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listMistakeReviews, ReviewValidationError, saveMistakeReviewEvent } from "@/lib/mistake-review";

export const runtime = "nodejs";
type Context = { params: Promise<{ gameId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const { gameId } = await params;
  try {
    if (!await prisma.chessGame.findUnique({ where: { id: gameId }, select: { id: true } })) return NextResponse.json({ error: "Saved game not found." }, { status: 404 });
    return NextResponse.json({ reviews: await listMistakeReviews(gameId) });
  } catch { return NextResponse.json({ error: "Could not load review history." }, { status: 500 }); }
}

export async function POST(request: Request, { params }: Context) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const { gameId } = await params;
  const body: unknown = await request.json().catch(() => null);
  try {
    if (!await prisma.chessGame.findUnique({ where: { id: gameId }, select: { id: true } })) return NextResponse.json({ error: "Saved game not found." }, { status: 404 });
    return NextResponse.json(await saveMistakeReviewEvent(gameId, body));
  } catch (error) {
    if (error instanceof ReviewValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Could not save review data." }, { status: 500 });
  }
}
