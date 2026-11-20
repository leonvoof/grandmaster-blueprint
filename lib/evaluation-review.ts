import { moveNumberAtPosition } from "./game-viewer-controls.ts";
import type { Analysis } from "@/lib/stockfish/position";
import { classifyGameMoves, type ClassificationThresholds } from "./game-review-classification.ts";

export type ReviewPoint = { ply: number; evaluation: number | null; mate: number | null; san: string | null; analysis: Analysis | null; analysisId?: string; settings?: string; fen?: string };
export function evaluationValue(analysis: Analysis | null) {
  if (!analysis?.score) return { evaluation: null, mate: null };
  return analysis.score.kind === "cp" ? { evaluation: analysis.score.value / 100, mate: null } : { evaluation: null, mate: analysis.score.value };
}
export function findCriticalMoves(points: ReviewPoint[], thresholds: ClassificationThresholds, classifications = classifyGameMoves(points, thresholds)) {
  return classifications.flatMap((move) => {
    if ((move.classification !== "Inaccuracy" && move.classification !== "Mistake" && move.classification !== "Blunder") || move.lossCp === null || move.evaluationBefore === null || move.evaluationAfter === null) return [];
    const before = points[move.ply - 1];
    return [{ ply: move.ply, moveNumber: moveNumberAtPosition(before.fen, move.ply), color: move.color, san: move.san, before: move.evaluationBefore, after: move.evaluationAfter, loss: move.lossCp / 100, classification: move.classification, alternative: move.bestMove, variation: move.continuation, analysisId: before.analysisId, fen: before.fen }];
  });
}
