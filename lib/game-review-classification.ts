import { Chess } from "chess.js";
import { moverAtPosition } from "./game-viewer-controls.ts";
import type { Analysis } from "@/lib/stockfish/position";
import type { ReviewPoint } from "@/lib/evaluation-review";

export type MoveClassification = "Brilliant" | "Great" | "Best" | "Excellent" | "Good" | "Inaccuracy" | "Mistake" | "Blunder" | "Book";
export type ClassifiedMove = { ply: number; san: string; color: "white" | "black"; classification: MoveClassification | null; lossCp: number | null; evaluationBefore: number | null; evaluationAfter: number | null; bestMove: string | null; continuation: string[]; reason: string };
export type ClassificationThresholds = { inaccuracy: number; mistake: number; blunder: number };

export const MIN_CLASSIFICATION_DEPTH = 12;
const EXPECTED_SCORE_LOSS_POINTS = { inaccuracy: 6, mistake: 10, blunder: 20 } as const;

/**
 * Conservative expected-score approximation for centipawn evaluations.
 * Stockfish's current UCI pipeline does not request or persist WDL triplets,
 * so use a logistic curve that flattens toward either extreme. The result
 * approximates expected score (wins plus half draws).
 */
function expectedScore(centipawns: number) {
  return 1 / (1 + Math.exp(-centipawns / 200));
}

export function classifyEvaluationMove(input: {
  fen: string;
  played: string;
  before: Analysis | null;
  after: Analysis | null;
  thresholds: ClassificationThresholds;
  minimumDepth?: number;
  settingsCompatible?: boolean;
}) {
  const { fen, played, before, after, thresholds } = input;
  const empty = { classification: null, lossCp: null, evaluationBefore: null, evaluationAfter: null, bestMove: null, continuation: [] as string[] } as const;
  if (!before?.score || !after?.score || before.engine !== after.engine || before.depth !== after.depth || input.settingsCompatible === false) {
    return { ...empty, reason: "Missing or incompatible adjacent saved analysis." };
  }
  const minimumDepth = input.minimumDepth ?? MIN_CLASSIFICATION_DEPTH;
  if (!Number.isInteger(before.depth) || before.depth < minimumDepth) {
    return { ...empty, reason: `Depth ${before.depth} is below the ${minimumDepth}-ply classification minimum.` };
  }
  if (before.score.kind !== "cp" || after.score.kind !== "cp") {
    return { ...empty, reason: "Mate scores are handled separately and are not converted to centipawns or expected-score loss." };
  }

  if (!Number.isFinite(before.score.value) || !Number.isFinite(after.score.value) || !before.variation.length) {
    return { ...empty, reason: "Finite evaluations and a pre-move principal variation are required." };
  }

  let moverSign: number;
  let continuation: string[];
  let playedSan: string;
  try {
    const replay = new Chess(fen);
    moverSign = replay.turn() === "w" ? 1 : -1;
    continuation = before.variation.map((san) => replay.move(san).san);
    playedSan = new Chess(fen).move(played).san;
  } catch {
    return { ...empty, reason: "Played move or saved principal variation is not legal from the pre-move position." };
  }

  const beforeCp = before.score.value * moverSign;
  const afterCp = after.score.value * moverSign;
  const lossCp = beforeCp - afterCp;
  const expectedBefore = expectedScore(beforeCp);
  const expectedAfter = expectedScore(afterCp);
  const expectedScoreLoss = (expectedBefore - expectedAfter) * 100;
  const bestMove = continuation[0] ?? null;
  const evaluationBefore = before.score.value / 100;
  const evaluationAfter = after.score.value / 100;
  const evidence = { lossCp, evaluationBefore, evaluationAfter, bestMove, continuation };

  const isBest = playedSan === bestMove;
  // A large improvement over the pre-move best score or a large drop after
  // playing that same best move indicates disagreement between the searches.
  if (expectedScoreLoss <= -EXPECTED_SCORE_LOSS_POINTS.mistake || (isBest && expectedScoreLoss >= EXPECTED_SCORE_LOSS_POINTS.inaccuracy)) {
    return { ...empty, reason: "The adjacent searches disagree materially about the move's value. Classification withheld." };
  }
  if (isBest) {
    return { ...evidence, classification: "Best" as MoveClassification, reason: "Matches the first legal move in the saved pre-move principal variation." };
  }

  let classification: MoveClassification;
  let reason: string;
  if (lossCp >= thresholds.blunder && expectedScoreLoss >= EXPECTED_SCORE_LOSS_POINTS.blunder) {
    classification = "Blunder";
    reason = `Estimated expected-score loss ${expectedScoreLoss.toFixed(1)} points and ${lossCp} cp meet the blunder minimums (20 points and ${thresholds.blunder} cp).`;
  } else if (lossCp >= thresholds.mistake && expectedScoreLoss >= EXPECTED_SCORE_LOSS_POINTS.mistake) {
    classification = "Mistake";
    reason = `Estimated expected-score loss ${expectedScoreLoss.toFixed(1)} points and ${lossCp} cp meet the mistake minimums (10 points and ${thresholds.mistake} cp).`;
  } else if (lossCp >= thresholds.inaccuracy && expectedScoreLoss >= EXPECTED_SCORE_LOSS_POINTS.inaccuracy) {
    classification = "Inaccuracy";
    reason = `Estimated expected-score loss ${expectedScoreLoss.toFixed(1)} points and ${lossCp} cp meet the inaccuracy minimums (6 points and ${thresholds.inaccuracy} cp).`;
  } else if (lossCp <= 10 && expectedScoreLoss <= 1.25) {
    classification = "Excellent";
    reason = `The move stays within 10 cp and 1.25 expected-score point of the saved pre-move evaluation.`;
  } else {
    classification = "Good";
    reason = `The move keeps enough of the position’s expected score to avoid a penalty. Estimated score loss is ${Math.max(0, expectedScoreLoss).toFixed(1)} points.`;
  }
  return { ...evidence, classification, reason };
}

export function classifyGameMoves(points: ReviewPoint[], thresholds: ClassificationThresholds, minimumDepth = MIN_CLASSIFICATION_DEPTH): ClassifiedMove[] {
  const moves: ClassifiedMove[] = [];
  for (let ply = 1; ply < points.length; ply++) {
    const before = points[ply - 1], after = points[ply];
    if (!after.san) continue;
    const color = moverAtPosition(before.fen, ply);
    const a = before.analysis, b = after.analysis;
    const assessment = classifyEvaluationMove({ fen: before.fen ?? "", played: after.san, before: a, after: b, thresholds, minimumDepth, settingsCompatible: before.settings === after.settings });
    moves.push({ ply, san: after.san, color, ...assessment });
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

export function classifiedMoveCount(summary: ReturnType<typeof summarizeClassifiedMoves>) {
  return Object.values(summary.byColor).reduce((total, counts) =>
    total + Object.values(counts).reduce((colorTotal, count) => colorTotal + count, 0), 0);
}
