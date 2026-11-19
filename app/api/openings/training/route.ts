import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildReviewablePositions, classifyReviewPositions, reconcileReviewPositions,
  resolveLegalUci, saveReviewOutcome, validReviewCounters,
} from "@/lib/opening-spaced-repetition";
import type { Color } from "chess.js";

export const runtime = "nodejs";

const isColor = (value: unknown): value is Color => value === "w" || value === "b";
const colorFromSide = (side: string): Color | null => side === "White" ? "w" : side === "Black" ? "b" : null;
type SerializedPositionFields = { contextPath: string; expectedMoves: string; recentSuccessHistory: string };
const parsePosition = <T extends SerializedPositionFields>(position: T) => {
  const { contextPath, expectedMoves, recentSuccessHistory, ...rest } = position;
  return {
    ...rest,
    contextPath: JSON.parse(contextPath) as string[],
    expectedMoves: JSON.parse(expectedMoves) as string[],
    recentSuccessHistory: JSON.parse(recentSuccessHistory) as number[],
  };
};

type ReviewRequest = {
  repertoireId: string;
  chapterId: string;
  positionId: string;
  trainingColor: Color;
  idempotencyKey: string;
  submittedMove: string | null;
  incorrectAttempts: number;
  hintsUsed: number;
  answersRevealed: number;
};

function isReviewRequest(value: unknown): value is ReviewRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return typeof body.repertoireId === "string" && typeof body.chapterId === "string"
    && typeof body.positionId === "string" && isColor(body.trainingColor)
    && typeof body.idempotencyKey === "string" && body.idempotencyKey.trim().length >= 8 && body.idempotencyKey.length <= 128
    && (body.submittedMove === null || typeof body.submittedMove === "string")
    && validReviewCounters(body);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const repertoireId = query.get("repertoireId");
  const chapterId = query.get("chapterId");
  const requestedColor = query.get("color");
  const positionIdentity = query.get("positionId");
  if (!repertoireId && !positionIdentity) return NextResponse.json({ error: "A repertoireId or positionId is required." }, { status: 400 });
  try {
    if (positionIdentity && !repertoireId) {
      const saved = await prisma.openingTrainingPosition.findUnique({
        where: { identity: positionIdentity }, include: { reviews: { orderBy: { reviewedAt: "desc" } } },
      });
      return saved
        ? NextResponse.json({ position: parsePosition(saved), history: saved.reviews })
        : NextResponse.json({ error: "Review position not found." }, { status: 404 });
    }
    const targetRepertoireId = repertoireId ?? "";
    const repertoire = await prisma.openingRepertoire.findUnique({
      where: { id: targetRepertoireId },
      include: { chapters: { include: { lines: true } } },
    });
    if (!repertoire) return NextResponse.json({ error: "Repertoire not found." }, { status: 404 });
    const color = requestedColor === null ? colorFromSide(repertoire.side) : isColor(requestedColor) ? requestedColor : null;
    if (!color || color !== colorFromSide(repertoire.side)) return NextResponse.json({ error: "Training color must match the repertoire side." }, { status: 400 });
    if (positionIdentity) {
      const saved = await prisma.openingTrainingPosition.findUnique({
        where: { identity: positionIdentity }, include: { reviews: { orderBy: { reviewedAt: "desc" } } },
      });
      if (!saved || saved.repertoireId !== repertoire.id || (chapterId && saved.chapterId !== chapterId)) {
        return NextResponse.json({ error: "Review position not found." }, { status: 404 });
      }
      return NextResponse.json({ position: parsePosition(saved), history: saved.reviews });
    }
    const chapters = chapterId ? repertoire.chapters.filter((chapter) => chapter.id === chapterId) : repertoire.chapters;
    if (chapterId && !chapters.length) return NextResponse.json({ error: "Chapter not found in this repertoire." }, { status: 404 });
    for (const chapter of chapters) {
      const reviewable = buildReviewablePositions(repertoire.id, chapter.id, color, chapter.lines);
      await reconcileReviewPositions(prisma, chapter.id, color, reviewable);
    }

    const all = await prisma.openingTrainingPosition.findMany({
      where: { repertoireId: targetRepertoireId, ...(chapterId ? { chapterId } : {}), trainingColor: color },
      orderBy: [{ nextReviewAt: "asc" }, { createdAt: "asc" }],
    });
    const groups = classifyReviewPositions(all, new Date());
    const serializeGroup = (items: typeof all) => items.map(parsePosition);
    // Activity is restricted to currently applicable identities so edited-out
    // branches keep their history but do not inflate active repertoire stats.
    const activeIds = all.filter((position) => position.applicable).map((position) => position.id);
    const reviewHistory = activeIds.length ? await prisma.openingTrainingReview.findMany({
      where: { positionId: { in: activeIds } },
      include: { position: { select: { identity: true, chapterId: true, fen: true, contextPath: true, expectedMoves: true, trainingColor: true, nextReviewAt: true, intervalDays: true, repetition: true } } },
      orderBy: { reviewedAt: "desc" },
    }) : [];
    const byChapter = chapters.map((chapter) => {
      const chapterPositions = all.filter((position) => position.chapterId === chapter.id);
      return { chapterId: chapter.id, chapterName: chapter.name, ...classifyReviewPositions(chapterPositions, new Date()).stats };
    });
    return NextResponse.json({
      repertoireId: targetRepertoireId, trainingColor: color,
      positions: serializeGroup(all),
      newPositions: serializeGroup(groups.newPositions),
      overdue: serializeGroup(groups.overdue),
      dueToday: serializeGroup(groups.dueToday),
      due: serializeGroup(groups.due),
      recentlyMastered: serializeGroup(groups.recentlyMastered),
      repeatedlyForgotten: serializeGroup(groups.repeatedlyForgotten),
      stats: groups.stats, chapters: byChapter, reviewHistory,
    });
  } catch {
    return NextResponse.json({ error: "Could not load opening review positions." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!isReviewRequest(body)) {
    return NextResponse.json({ error: "Review outcome is malformed." }, { status: 400 });
  }
  try {
    const chapter = await prisma.openingChapter.findUnique({
      where: { id: body.chapterId }, include: { repertoire: true, lines: true },
    });
    if (!chapter || chapter.repertoireId !== body.repertoireId) return NextResponse.json({ error: "Chapter does not belong to this repertoire." }, { status: 404 });
    const color = colorFromSide(chapter.repertoire.side);
    if (!color || color !== body.trainingColor) return NextResponse.json({ error: "Training color does not match the repertoire." }, { status: 400 });
    const reviewable = buildReviewablePositions(chapter.repertoireId, chapter.id, color, chapter.lines);
    const position = reviewable.find((candidate) => candidate.identity === body.positionId);
    if (!position) return NextResponse.json({ error: "This position is no longer part of the saved repertoire." }, { status: 409 });
    let submittedMove: string | null = null;
    if (body.submittedMove !== null) {
      submittedMove = resolveLegalUci(position.fen, body.submittedMove);
      if (!submittedMove) return NextResponse.json({ error: "Submitted move is illegal or malformed." }, { status: 400 });
    }
    if (!submittedMove && body.answersRevealed === 0 && body.hintsUsed === 0 && body.incorrectAttempts === 0) {
      return NextResponse.json({ error: "A move, hint, incorrect attempt, or answer reveal is required." }, { status: 400 });
    }

    const outcome = {
      idempotencyKey: body.idempotencyKey.trim(), submittedMove,
      incorrectAttempts: body.incorrectAttempts, hintsUsed: body.hintsUsed, answersRevealed: body.answersRevealed,
    };
    try {
      const result = await saveReviewOutcome(prisma, position, outcome);
      return NextResponse.json({ ...result, duplicate: false });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") {
        const duplicate = await prisma.openingTrainingReview.findUnique({ where: { idempotencyKey: outcome.idempotencyKey }, include: { position: true } });
        if (duplicate?.position.identity !== position.identity) return NextResponse.json({ error: "This idempotency key belongs to another review." }, { status: 409 });
        return NextResponse.json({ review: duplicate, position: duplicate.position, duplicate: true });
      }
      throw error;
    }
  } catch {
    return NextResponse.json({ error: "Could not save opening review." }, { status: 500 });
  }
}
