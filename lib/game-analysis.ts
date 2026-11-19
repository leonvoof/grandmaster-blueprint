import { Chess } from "chess.js";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { analysisPosition } from "@/lib/stockfish/position";

export type PositionAnalysisInput = {
  fen: string;
  ply: number;
  engine: string;
  settings: string;
  depth: number;
  score: { kind: "cp" | "mate"; value: number } | null;
  bestMove: string | null;
  variation: string[];
  terminal?: string;
  note?: string;
};

export class AnalysisValidationError extends Error {}

function validate(input: unknown): PositionAnalysisInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AnalysisValidationError("Invalid analysis payload.");
  const value = input as Record<string, unknown>;
  if (typeof value.fen !== "string") throw new AnalysisValidationError("A valid FEN is required.");
  try { analysisPosition(value.fen); } catch (error) { throw new AnalysisValidationError(error instanceof Error ? error.message : "Invalid FEN."); }
  if (!Number.isSafeInteger(value.ply) || (value.ply as number) < 0) throw new AnalysisValidationError("Ply must be a non-negative integer.");
  if (typeof value.engine !== "string" || !value.engine.trim() || value.engine.length > 120) throw new AnalysisValidationError("Engine version is required.");
  if (typeof value.settings !== "string" || !value.settings.trim() || value.settings.length > 300) throw new AnalysisValidationError("Analysis settings are required.");
  if (!Number.isInteger(value.depth) || (value.depth as number) < 1 || (value.depth as number) > 100) throw new AnalysisValidationError("Depth must be from 1 to 100.");
  if (value.score !== null && (!value.score || typeof value.score !== "object" || !["cp", "mate"].includes((value.score as Record<string, unknown>).kind as string) || !Number.isSafeInteger((value.score as Record<string, unknown>).value))) throw new AnalysisValidationError("Invalid evaluation score.");
  if (value.bestMove !== null && typeof value.bestMove !== "string") throw new AnalysisValidationError("Best move must be SAN or null.");
  if (!Array.isArray(value.variation) || value.variation.length > 100 || value.variation.some((move) => typeof move !== "string")) throw new AnalysisValidationError("Invalid principal variation.");
  if (value.terminal !== undefined && typeof value.terminal !== "string") throw new AnalysisValidationError("Invalid terminal status.");
  if (value.note !== undefined && (typeof value.note !== "string" || value.note.length > 4000)) throw new AnalysisValidationError("Notes must be 4000 characters or fewer.");
  const chess = new Chess(value.fen);
  try { for (const san of value.variation as string[]) chess.move(san); }
  catch { throw new AnalysisValidationError("Principal variation contains an illegal move."); }
  return value as PositionAnalysisInput;
}

export async function savePositionAnalysis(gameId: string, input: unknown, db: PrismaClient = prisma) {
  const value = validate(input);
  const key = { gameId_fen_engine_settings_depth: { gameId, fen: value.fen, engine: value.engine, settings: value.settings, depth: value.depth } };
  return db.gameAnalysis.upsert({
    where: key,
    create: {
      gameId, fen: value.fen, ply: value.ply, engine: value.engine, settings: value.settings, depth: value.depth,
      scoreType: value.score?.kind ?? null, scoreValue: value.score?.value ?? null, bestMove: value.bestMove,
      variation: JSON.stringify(value.variation), terminal: value.terminal ?? null, note: value.note ?? null,
    },
    update: {
      ply: value.ply, scoreType: value.score?.kind ?? null, scoreValue: value.score?.value ?? null,
      bestMove: value.bestMove, variation: JSON.stringify(value.variation), terminal: value.terminal ?? null,
      ...(value.note !== undefined ? { note: value.note } : {}),
    },
  });
}

export async function listGameAnalyses(gameId: string, db: PrismaClient = prisma) {
  return db.gameAnalysis.findMany({ where: { gameId }, orderBy: { ply: "asc" } });
}
