import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Chess } from "chess.js";
export async function GET(request: Request) {
 const puzzleId = new URL(request.url).searchParams.get("puzzleId");
 if (!puzzleId) return NextResponse.json({ error: "Puzzle ID is required." }, { status: 400 });
 const attempts = await prisma.tacticsAttempt.findMany({ where: { puzzleId }, orderBy: { createdAt: "desc" } });
 return NextResponse.json({ attempts: attempts.map((a) => ({ ...a, submittedMoves: JSON.parse(a.submittedMoves) })) });
}
export async function POST(request: Request) {
 try {
  const b = await request.json();
  if (typeof b.puzzleId !== "string" || typeof b.idempotencyKey !== "string" || !Array.isArray(b.submittedMoves) || b.submittedMoves.length > 100 || !Number.isInteger(b.solvingTimeMs) || b.solvingTimeMs < 0 || !Number.isInteger(b.hintsUsed) || b.hintsUsed < 0) return NextResponse.json({ error: "Invalid attempt." }, { status: 400 });
  const puzzle = await prisma.tacticsPuzzle.findUnique({ where: { id: b.puzzleId } });
  if (!puzzle) return NextResponse.json({ error: "Puzzle not found." }, { status: 404 });
  const solution: string[] = JSON.parse(puzzle.solution); const submitted: string[] = b.submittedMoves;
  const first = submitted[0] === solution[0]; const completed = submitted.length >= solution.length && solution.every((m, i) => submitted[i] === m);
  // Replay both lines so only legal UCI move submissions are persisted.
  const chess = new Chess(puzzle.fen); for (const m of submitted) chess.move({ from: m.slice(0,2), to: m.slice(2,4), promotion: m[4] });
  const attempt = await prisma.tacticsAttempt.create({ data: { puzzleId: puzzle.id, idempotencyKey: b.idempotencyKey, submittedMoves: JSON.stringify(submitted), firstAttemptCorrect: first, solvingTimeMs: b.solvingTimeMs, hintsUsed: b.hintsUsed, solutionRevealed: Boolean(b.solutionRevealed), completed } });
  return NextResponse.json({ attempt }, { status: 201 });
 } catch { return NextResponse.json({ error: "Invalid or duplicate attempt submission." }, { status: 400 }); }
}
