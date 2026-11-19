import { createHash } from "node:crypto";
import { Chess, type Color, type Move } from "chess.js";
import type { PrismaClient } from "@prisma/client";

export type ReviewablePosition = {
  identity: string;
  repertoireId: string;
  chapterId: string;
  trainingColor: Color;
  startingFen: string;
  fen: string;
  contextPath: string[];
  expectedMoves: string[];
};

export type ReviewOutcome = {
  idempotencyKey: string;
  submittedMove: string | null;
  incorrectAttempts: number;
  hintsUsed: number;
  answersRevealed: number;
};

export type Schedule = {
  grade: number;
  firstAttemptCorrect: boolean;
  intervalDays: number;
  repetition: number;
  easeFactor: number;
  recentSuccessHistory: number[];
  lastReviewAt: Date;
  nextReviewAt: Date;
};

const uci = (move: Pick<Move, "from" | "to" | "promotion">) => `${move.from}${move.to}${move.promotion ?? ""}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export function reviewPositionIdentity(repertoireId: string, chapterId: string, color: Color, startingFen: string, fen: string, contextPath: readonly string[]) {
  return sha(JSON.stringify([repertoireId, chapterId, color, startingFen, fen, contextPath]));
}

export function buildReviewablePositions(
  repertoireId: string,
  chapterId: string,
  color: Color,
  lines: readonly { pgn: string }[],
): ReviewablePosition[] {
  const positions = new Map<string, ReviewablePosition>();
  for (const { pgn } of lines) {
    const chess = new Chess();
    try { chess.loadPgn(pgn); } catch { continue; }
    const history = chess.history({ verbose: true });
    if (!history.length) continue;
    const startingFen = history[0].before;
    for (let index = 0; index < history.length; index++) {
      const move = history[index];
      if (move.color !== color) continue;
      const contextPath = history.slice(0, index).map((played) => played.san);
      // Context is part of identity: transpositions reached by different lines
      // are deliberately kept separate instead of silently merging histories.
      const identity = reviewPositionIdentity(repertoireId, chapterId, color, startingFen, move.before, contextPath);
      const previous = positions.get(identity);
      if (previous) {
        if (!previous.expectedMoves.includes(uci(move))) previous.expectedMoves.push(uci(move));
      } else {
        positions.set(identity, {
          identity, repertoireId, chapterId, trainingColor: color, startingFen,
          fen: move.before, contextPath, expectedMoves: [uci(move)],
        });
      }
    }
  }
  return [...positions.values()];
}

export function resolveLegalUci(fen: string, submittedMove: string): string | null {
  const trimmed = submittedMove.trim();
  try {
    const chess = new Chess(fen);
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(trimmed)) {
      const move = chess.move({ from: trimmed.slice(0, 2).toLowerCase(), to: trimmed.slice(2, 4).toLowerCase(), ...(trimmed[4] ? { promotion: trimmed[4].toLowerCase() } : {}) });
      return uci(move);
    }
    return uci(chess.move(trimmed));
  } catch { return null; }
}

export function calculateSchedule(
  previous: { repetition: number; intervalDays: number; easeFactor: number; recentSuccessHistory: string | number[] },
  outcome: Omit<ReviewOutcome, "idempotencyKey"> & { submittedMoveIsExpected: boolean },
  now = new Date(),
): Schedule {
  const firstAttemptCorrect = outcome.submittedMoveIsExpected
    && outcome.incorrectAttempts === 0 && outcome.hintsUsed === 0 && outcome.answersRevealed === 0;
  const grade = !outcome.submittedMoveIsExpected || outcome.answersRevealed > 0 ? 0
    : outcome.incorrectAttempts > 0 ? 2
      : outcome.hintsUsed > 0 ? 3 : 5;
  const delta = 5 - grade;
  const easeFactor = Math.max(1.3, previous.easeFactor + 0.1 - delta * (0.08 + delta * 0.02));
  const repetition = grade < 3 ? 0 : previous.repetition + 1;
  let intervalDays = grade < 3 ? 1 : repetition === 1 ? 1 : repetition === 2 ? 6 : Math.max(1, Math.round(previous.intervalDays * easeFactor));
  if (grade === 2) intervalDays = 1;
  if (grade === 0) intervalDays = 1;
  const history = (typeof previous.recentSuccessHistory === "string"
    ? JSON.parse(previous.recentSuccessHistory) as number[] : previous.recentSuccessHistory).slice(-7);
  history.push(grade);
  const lastReviewAt = new Date(now);
  const nextReviewAt = new Date(now.getTime() + intervalDays * 86_400_000);
  return { grade, firstAttemptCorrect, intervalDays, repetition, easeFactor, recentSuccessHistory: history, lastReviewAt, nextReviewAt };
}

export function classifyReviewPositions<T extends {
  identity: string; applicable: boolean; lastReviewAt: Date | null; nextReviewAt: Date | null;
  intervalDays: number; recentSuccessHistory: string;
}>(positions: readonly T[], now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  const applicable = positions.filter((position) => position.applicable);
  const fresh = applicable.filter((position) => !position.lastReviewAt);
  const overdue = applicable.filter((position) => position.nextReviewAt !== null && position.nextReviewAt < start);
  const dueToday = applicable.filter((position) => position.nextReviewAt !== null && position.nextReviewAt >= start && position.nextReviewAt < end);
  const recentlyMastered = applicable.filter((position) => position.intervalDays >= 21 && position.nextReviewAt !== null && position.nextReviewAt > end);
  const repeatedlyForgotten = applicable.filter((position) => {
    try { return (JSON.parse(position.recentSuccessHistory) as number[]).slice(-2).length === 2 && (JSON.parse(position.recentSuccessHistory) as number[]).slice(-2).every((grade) => grade < 3); }
    catch { return false; }
  });
  return {
    newPositions: fresh,
    overdue,
    dueToday,
    due: [...overdue, ...dueToday],
    recentlyMastered,
    repeatedlyForgotten,
    stats: { applicable: applicable.length, new: fresh.length, due: overdue.length + dueToday.length, overdue: overdue.length, recentlyMastered: recentlyMastered.length, repeatedlyForgotten: repeatedlyForgotten.length },
  };
}

export function validReviewCounters(value: Record<string, unknown>) {
  return ["incorrectAttempts", "hintsUsed", "answersRevealed"].every((key) => Number.isInteger(value[key]) && Number(value[key]) >= 0 && Number(value[key]) <= 100);
}

export async function reconcileReviewPositions(db: PrismaClient, chapterId: string, color: Color, positions: readonly ReviewablePosition[]) {
  const existing = await db.openingTrainingPosition.findMany({ where: { chapterId, trainingColor: color } });
  const activeIdentities = new Set(positions.map((position) => position.identity));
  await db.$transaction(async (tx) => {
    for (const position of positions) {
      const data = {
        repertoireId: position.repertoireId, chapterId: position.chapterId, trainingColor: position.trainingColor,
        startingFen: position.startingFen, fen: position.fen, contextPath: JSON.stringify(position.contextPath),
        expectedMoves: JSON.stringify(position.expectedMoves), applicable: true,
      };
      await tx.openingTrainingPosition.upsert({ where: { identity: position.identity }, create: { identity: position.identity, ...data }, update: data });
    }
    for (const position of existing) {
      if (!activeIdentities.has(position.identity) && position.applicable) {
        await tx.openingTrainingPosition.update({ where: { id: position.id }, data: { applicable: false } });
      }
    }
  });
}

export async function saveReviewOutcome(db: PrismaClient, position: ReviewablePosition, outcome: ReviewOutcome, now = new Date()) {
  return db.$transaction(async (tx) => {
    const data = {
      repertoireId: position.repertoireId, chapterId: position.chapterId, trainingColor: position.trainingColor,
      startingFen: position.startingFen, fen: position.fen, contextPath: JSON.stringify(position.contextPath),
      expectedMoves: JSON.stringify(position.expectedMoves), applicable: true,
    };
    const saved = await tx.openingTrainingPosition.upsert({ where: { identity: position.identity }, create: { identity: position.identity, ...data }, update: data });
    const legalUci = outcome.submittedMove ? resolveLegalUci(position.fen, outcome.submittedMove) : null;
    const expected = legalUci !== null && position.expectedMoves.includes(legalUci);
    const schedule = calculateSchedule(saved, { ...outcome, submittedMoveIsExpected: expected }, now);
    const updated = await tx.openingTrainingPosition.update({ where: { id: saved.id }, data: {
      lastReviewAt: schedule.lastReviewAt, nextReviewAt: schedule.nextReviewAt,
      intervalDays: schedule.intervalDays, repetition: schedule.repetition, easeFactor: schedule.easeFactor,
      recentSuccessHistory: JSON.stringify(schedule.recentSuccessHistory),
    } });
    const review = await tx.openingTrainingReview.create({ data: {
      positionId: saved.id, idempotencyKey: outcome.idempotencyKey, submittedMove: legalUci,
      firstAttemptCorrect: schedule.firstAttemptCorrect, incorrectAttempts: outcome.incorrectAttempts,
      hintsUsed: outcome.hintsUsed, answersRevealed: outcome.answersRevealed, grade: schedule.grade, reviewedAt: now,
    } });
    return { position: updated, review, schedule };
  });
}
