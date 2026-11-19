import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { selectPuzzleQuery } from "@/lib/tactics";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const minRating = Number(params.get("minRating") ?? 0), maxRating = Number(params.get("maxRating") ?? 4000), limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? 20)));
  if (![minRating, maxRating, limit].every(Number.isInteger) || minRating > maxRating) return NextResponse.json({ error: "Invalid rating range or limit." }, { status: 400 });
  const puzzles = await prisma.tacticsPuzzle.findMany({ where: selectPuzzleQuery({ minRating, maxRating, theme: params.get("theme") ?? undefined, failed: params.get("failed") === "true", unattempted: params.get("unattempted") === "true" }), take: limit, orderBy: { rating: "asc" } });
  return NextResponse.json({ puzzles: puzzles.map((p) => ({ ...p, solution: JSON.parse(p.solution), themes: JSON.parse(p.themes) })) });
}
