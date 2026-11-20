import { privateRouteDisabled } from "@/lib/site-mode";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exportOpeningDocument } from "@/lib/opening-export";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const params = new URL(request.url).searchParams;
  const chapterId = params.get("chapterId");
  const repertoireId = params.get("repertoireId");
  if (!chapterId && !repertoireId) return NextResponse.json({ error: "Select a chapter or repertoire." }, { status: 400 });
  try {
    const chapters = await prisma.openingChapter.findMany({ where: chapterId ? { id: chapterId } : { repertoireId: repertoireId! }, include: { lines: { orderBy: { createdAt: "asc" } }, notes: true }, orderBy: { createdAt: "asc" } });
    if (!chapters.length) return NextResponse.json({ error: "No saved chapters to export." }, { status: 404 });
    const document = exportOpeningDocument(chapters);
    return new Response(document, { headers: { "Content-Type": "application/x-chess-pgn; charset=utf-8", "Content-Disposition": "attachment; filename=opening-repertoire.pgn" } });
  } catch { return NextResponse.json({ error: "Could not export repertoire." }, { status: 500 }); }
}
