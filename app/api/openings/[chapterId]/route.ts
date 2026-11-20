import { privateRouteDisabled } from "@/lib/site-mode";
import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { prisma } from "@/lib/prisma";
import { lineIdentity } from "@/lib/opening-tree";
export const runtime = "nodejs";
type Context = { params: Promise<{ chapterId: string }> };
export async function PATCH(request: Request, { params }: Context) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const { chapterId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    if (body.action === "line") {
      if (typeof body.name !== "string" || !body.name.trim() || typeof body.pgn !== "string") throw new Error("Enter a variation name and PGN.");
      const chess = new Chess(); chess.loadPgn(body.pgn);
      const duplicate = await prisma.openingLine.findMany({ where: { chapterId, ...(typeof body.id === "string" ? { id: { not: body.id } } : {}) }, select: { id: true, pgn: true } });
      if (duplicate.some((line) => lineIdentity(line.pgn) === lineIdentity(body.pgn))) throw new Error("This exact move line already exists in the chapter.");
      const line = typeof body.id === "string"
        ? await prisma.openingLine.update({ where: { id: body.id, chapterId }, data: { name: body.name.trim(), pgn: body.pgn.trim(), preferred: Boolean(body.preferred) } })
        : await prisma.openingLine.create({ data: { chapterId, name: body.name.trim(), pgn: body.pgn.trim(), preferred: Boolean(body.preferred) } });
      return NextResponse.json({ line });
    }
    if (body.action === "delete-line") return NextResponse.json({ deleted: await prisma.openingLine.deleteMany({ where: { id: body.id, chapterId } }) });
    if (body.action === "preferred") return NextResponse.json({ line: await prisma.openingLine.update({ where: { id: body.id, chapterId }, data: { preferred: Boolean(body.preferred) } }) });
    if (body.action === "note") {
      if (typeof body.fen !== "string" || typeof body.text !== "string") throw new Error("Position and note are required.");
      new Chess(body.fen);
      return NextResponse.json({ note: await prisma.openingNote.upsert({ where: { chapterId_fen: { chapterId, fen: body.fen } }, create: { chapterId, fen: body.fen, text: body.text }, update: { text: body.text } }) });
    }
    throw new Error("Unknown action.");
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update chapter." }, { status: 400 }); }
}
