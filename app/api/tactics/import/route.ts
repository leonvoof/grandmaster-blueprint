import { privateRouteDisabled } from "@/lib/site-mode";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parsePuzzleRow, type PuzzleInput } from "@/lib/tactics";
export async function POST(request: Request) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  try {
    const body = await request.json();
    if (!Array.isArray(body.puzzles) || body.puzzles.length > 500) return NextResponse.json({ error: "Provide up to 500 puzzle rows per import." }, { status: 400 });
    const parsed = body.puzzles.map((row: PuzzleInput) => parsePuzzleRow(row));
    const results = await prisma.$transaction(parsed.map((puzzle: ReturnType<typeof parsePuzzleRow>) => prisma.tacticsPuzzle.upsert({ where: { id: puzzle.id }, create: puzzle, update: {} })));
    return NextResponse.json({ imported: results.length, source: "Lichess Puzzle Database", license: "CC0 1.0 Universal (Public Domain)" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid puzzle import." }, { status: 400 }); }
}
