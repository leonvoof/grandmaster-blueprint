import { Chess } from "chess.js";
import { moverAtPosition } from "./game-viewer-controls.ts";
import type { ReviewPoint } from "@/lib/evaluation-review";

export type MoveClassification = "Brilliant" | "Great" | "Best" | "Excellent" | "Good" | "Inaccuracy" | "Mistake" | "Blunder" | "Book";
export type ClassifiedMove = { ply: number; san: string; color: "white" | "black"; classification: MoveClassification | null; lossCp: number | null; evaluationBefore: number | null; evaluationAfter: number | null; bestMove: string | null; continuation: string[]; reason: string };
export type ClassificationThresholds = { inaccuracy: number; mistake: number; blunder: number };

export function classifyGameMoves(points: ReviewPoint[], thresholds: ClassificationThresholds, minimumDepth = 10): ClassifiedMove[] {
  const moves: ClassifiedMove[] = [];
  for (let ply = 1; ply < points.length; ply++) {
    const before = points[ply - 1], after = points[ply];
    if (!after.san) continue;
    const color = moverAtPosition(before.fen, ply);
    const base = { ply, san: after.san, color, lossCp: null, evaluationBefore: null, evaluationAfter: null, bestMove: null, continuation: [] as string[] };
    const a = before.analysis, b = after.analysis;
    if (!a?.score || !b?.score || a.engine !== b.engine || a.depth !== b.depth || before.settings !== after.settings) {
      moves.push({ ...base, classification: null, reason: "Missing or incompatible adjacent saved analysis." });
      continue;
    }
    if (a.depth < minimumDepth) {
      moves.push({ ...base, classification: null, reason: `Depth ${a.depth} is below the ${minimumDepth}-ply classification minimum.` });
      continue;
    }
    if (a.score.kind !== "cp" || b.score.kind !== "cp") {
      moves.push({ ...base, classification: null, reason: "Mate scores are handled separately and are not converted to centipawns." });
      continue;
    }
    let continuation: string[];
    try {
      const replay = new Chess(before.fen ?? "");
      continuation = a.variation.map((san) => replay.move(san).san);
    } catch {
      moves.push({ ...base, classification: null, reason: "Saved principal variation is not legal from the pre-move position." });
      continue;
    }
    const played = after.san;
    const validatedBest = continuation[0] ?? null;
    const lossCp = color === "white" ? a.score.value - b.score.value : b.score.value - a.score.value;
    const evaluationBefore = a.score.value / 100;
    const evaluationAfter = b.score.value / 100;
    let classification: MoveClassification;
    let reason: string;
    if (validatedBest && played === validatedBest) {
      classification = "Best";
      reason = "Matches the first legal move in the saved pre-move principal variation.";
    } else if (lossCp >= thresholds.blunder) {
      classification = "Blunder"; reason = `Lost ${lossCp} cp from the mover's perspective (blunder threshold ${thresholds.blunder} cp).`;
    } else if (lossCp >= thresholds.mistake) {
      classification = "Mistake"; reason = `Lost ${lossCp} cp from the mover's perspective (mistake threshold ${thresholds.mistake} cp).`;
    } else if (lossCp >= thresholds.inaccuracy) {
      classification = "Inaccuracy"; reason = `Lost ${lossCp} cp from the mover's perspective (inaccuracy threshold ${thresholds.inaccuracy} cp).`;
    } else if (lossCp <= 10) {
      classification = "Excellent"; reason = `Evaluation loss was ${lossCp} cp, within the 10 cp Excellent band.`;
    } else {
      classification = "Good"; reason = `Evaluation loss was ${lossCp} cp, below the configured inaccuracy threshold.`;
    }
    moves.push({ ...base, classification, lossCp, evaluationBefore, evaluationAfter, bestMove: validatedBest, continuation, reason });
  }
  return moves;
}

export function exceptionalMoveEligibility(evidence: { deepVerifiedMultiPv: boolean; corroboratedSacrifice: boolean; winningOnlyMove: boolean }): { brilliant: boolean; great: boolean; reason: string } {
  if (!evidence.deepVerifiedMultiPv) return { brilliant: false, great: false, reason: "Brilliant/Great require deeper verified multi-PV analysis, which is not stored." };
  if (!evidence.corroboratedSacrifice || !evidence.winningOnlyMove) return { brilliant: false, great: false, reason: "Saved evidence does not establish a verified exceptional move." };
  return { brilliant: false, great: false, reason: "Exceptional labels are disabled until the engine evidence is independently verified." };
}

export function summarizeClassifiedMoves(moves: ClassifiedMove[]) {
  const colors = ["white", "black"] as const;
  const labels: MoveClassification[] = ["Brilliant", "Great", "Best", "Excellent", "Good", "Inaccuracy", "Mistake", "Blunder", "Book"];
  const byColor = Object.fromEntries(colors.map((color) => [color, Object.fromEntries(labels.map((label) => [label, moves.filter((move) => move.color === color && move.classification === label).length]))])) as Record<(typeof colors)[number], Record<MoveClassification, number>>;
  const critical = moves.filter((move) => move.classification === "Inaccuracy" || move.classification === "Mistake" || move.classification === "Blunder");
  return { byColor, critical, bestMoves: moves.filter((move) => move.classification === "Best"), missedOpportunities: critical.filter((move) => move.bestMove) };
}
