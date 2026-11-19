import { Chess } from "chess.js";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { analysisPosition } from "@/lib/stockfish/position";

export class ReviewValidationError extends Error {}

const noteKeys = ["thinking", "overlooked", "variations", "learned", "recognition"] as const;
type Reflection = Record<(typeof noteKeys)[number], string>;

export async function listMistakeReviews(gameId: string, db: PrismaClient = prisma) {
  const analyses = await db.gameAnalysis.findMany({
    where: { gameId }, orderBy: { ply: "asc" },
    include: { reviewEvents: { orderBy: { createdAt: "asc" } }, reflection: true },
  });
  return analyses.map(({ reviewEvents, reflection, ...analysis }) => ({
    analysisId: analysis.id, fen: analysis.fen, ply: analysis.ply, engine: analysis.engine,
    settings: analysis.settings, depth: analysis.depth,
    reflection: reflection ? { thinking: reflection.thinking, overlooked: reflection.overlooked, variations: reflection.variations, learned: reflection.learned, recognition: reflection.recognition } : emptyReflection(), events: reviewEvents,
  }));
}

function emptyReflection(): Reflection { return Object.fromEntries(noteKeys.map((key) => [key, ""])) as Reflection; }

export async function saveMistakeReviewEvent(gameId: string, input: unknown, db: PrismaClient = prisma) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ReviewValidationError("Invalid review request.");
  const body = input as Record<string, unknown>;
  if (typeof body.analysisId !== "string" || !body.analysisId) throw new ReviewValidationError("An analysis position is required.");
  const analysis = await db.gameAnalysis.findFirst({ where: { id: body.analysisId, gameId } });
  if (!analysis) throw new ReviewValidationError("This analysis position does not belong to the saved game.");
  if (body.action === "save-reflection") {
    if (!body.reflection || typeof body.reflection !== "object" || Array.isArray(body.reflection)) throw new ReviewValidationError("Reflection fields are required.");
    const reflection = {} as Reflection;
    for (const key of noteKeys) {
      const value = (body.reflection as Record<string, unknown>)[key];
      if (typeof value !== "string" || value.length > 4000) throw new ReviewValidationError("Reflection entries must be text with at most 4000 characters each.");
      reflection[key] = value;
    }
    const updated = await db.mistakeReflection.upsert({ where: { gameAnalysisId: analysis.id }, create: { gameAnalysisId: analysis.id, ...reflection }, update: reflection });
    return { type: "reflection" as const, reflection: { thinking: updated.thinking, overlooked: updated.overlooked, variations: updated.variations, learned: updated.learned, recognition: updated.recognition } };
  }
  if (body.action === "reveal") {
    const event = await db.reviewEvent.create({ data: { gameAnalysisId: analysis.id, kind: "reveal" } });
    return { type: "event" as const, event };
  }
  if (body.action === "hint") {
    const event = await db.reviewEvent.create({ data: { gameAnalysisId: analysis.id, kind: "hint" } });
    return { type: "event" as const, event };
  }
  if (body.action === "submit") {
    if (typeof body.move !== "string" || body.move.length > 12) throw new ReviewValidationError("Submit a legal move in this position.");
    let san: string;
    try {
      analysisPosition(analysis.fen);
      const chess = new Chess(analysis.fen);
      san = chess.move(body.move).san;
    } catch { throw new ReviewValidationError("That move is not legal in this position."); }
    const matchedBest = analysis.bestMove ? san === analysis.bestMove : null;
    const earlierSubmissions = await db.reviewEvent.count({ where: { gameAnalysisId: analysis.id, kind: "submit" } });
    const event = await db.reviewEvent.create({ data: { gameAnalysisId: analysis.id, kind: "submit", submittedSan: san, matchedBest } });
    return { type: "event" as const, event, firstAttempt: earlierSubmissions === 0 };
  }
  throw new ReviewValidationError("Unknown review action.");
}
