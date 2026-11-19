import type { Analysis } from "@/lib/stockfish/position";

export type ReviewPoint = { ply: number; evaluation: number | null; mate: number | null; san: string | null; analysis: Analysis | null; analysisId?: string; settings?: string; fen?: string };
export type Classification = "Acceptable" | "Inaccuracy" | "Mistake" | "Blunder";
export function classifyLoss(loss: number, thresholds: { inaccuracy: number; mistake: number; blunder: number }): Classification {
  if (loss >= thresholds.blunder) return "Blunder";
  if (loss >= thresholds.mistake) return "Mistake";
  if (loss >= thresholds.inaccuracy) return "Inaccuracy";
  return "Acceptable";
}
export function evaluationValue(analysis: Analysis | null) {
  if (!analysis?.score) return { evaluation: null, mate: null };
  return analysis.score.kind === "cp" ? { evaluation: analysis.score.value / 100, mate: null } : { evaluation: null, mate: analysis.score.value };
}
export function findCriticalMoves(points: ReviewPoint[], thresholds: { inaccuracy: number; mistake: number; blunder: number }) {
  const critical = [];
  for (let ply = 1; ply < points.length; ply++) {
    const before = points[ply - 1], after = points[ply];
    if (!before.analysis?.score || !after.analysis?.score || before.analysis.engine !== after.analysis.engine || before.analysis.depth !== after.analysis.depth || before.settings !== after.settings || !after.san) continue;
    const a = before.analysis.score, b = after.analysis.score;
    if (a.kind !== "cp" || b.kind !== "cp") continue;
    const loss = ply % 2 === 1 ? a.value - b.value : b.value - a.value;
    if (loss <= 0) continue;
    const classification = classifyLoss(loss, thresholds);
    if (classification !== "Acceptable") critical.push({ ply, moveNumber: Math.ceil(ply / 2), san: before.san, before: a.value / 100, after: b.value / 100, loss: loss / 100, classification, alternative: before.analysis.bestMove, variation: before.analysis.variation, analysisId: before.analysisId, fen: before.fen });
  }
  return critical;
}
