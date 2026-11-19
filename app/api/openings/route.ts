import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export const runtime = "nodejs";
export async function GET() {
  try { return NextResponse.json({ repertoires: await prisma.openingRepertoire.findMany({ include: { chapters: { include: { lines: true, notes: true }, orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } }) }); }
  catch { return NextResponse.json({ error: "Could not load repertoires." }, { status: 500 }); }
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim() || !["White", "Black"].includes(body.side)) return NextResponse.json({ error: "Enter a repertoire name and side." }, { status: 400 });
  try { return NextResponse.json({ repertoire: await prisma.openingRepertoire.create({ data: { name: body.name.trim(), side: body.side } }) }); }
  catch { return NextResponse.json({ error: "Could not create repertoire." }, { status: 500 }); }
}
