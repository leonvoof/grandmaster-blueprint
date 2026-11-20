import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
registerHooks({ resolve(specifier, context, nextResolve) { return specifier.startsWith("@/") ? nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context) : nextResolve(specifier, context); } });
const { classifyGameMoves, exceptionalMoveEligibility, summarizeClassifiedMoves, classifiedMoveCount } = await import("../lib/game-review-classification.ts");
const thresholds = { inaccuracy: 50, mistake: 100, blunder: 200 };
const position = (ply, san, score, best = "Nf3", depth = 12, kind = "cp", variation = [best, "Nc6"]) => ({
  ply, san, fen: ply === 1 ? "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" : ply === 2 ? "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2" : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", settings: "lite", evaluation: score / 100,
  mate: null, analysisId: `a${ply}`, analysis: { engine: "sf19", depth, score: { kind, value: score }, bestMove: best, variation },
});

test("classifications use mover perspective, compatible saved positions, and validated PV best move", () => {
  const white = classifyGameMoves([position(0, null, 10), position(1, "Nf3", 10)], thresholds)[0];
  assert.equal(white.color, "white"); assert.equal(white.classification, "Best");
  const black = classifyGameMoves([position(0, null, 0), position(1, "e4", 0, "Nf6", 12, "cp", ["Nf6"]), position(2, "e5", 40)], thresholds)[1];
  assert.equal(black.color, "black"); assert.equal(black.lossCp, 40); assert.equal(black.classification, "Good");
  assert.equal(black.bestMove, "Nf6");
});

test("Excellent, Good, Inaccuracy, Mistake, and Blunder use explicit bands and configured thresholds", () => {
  const make = (loss, ply = 1) => classifyGameMoves([position(0, null, 0), position(ply, "a3", -loss)], thresholds)[0].classification;
  assert.equal(make(10), "Excellent"); assert.equal(make(49), "Good");
  assert.equal(make(50), "Inaccuracy"); assert.equal(make(100), "Mistake"); assert.equal(make(200), "Blunder");
  assert.equal(classifyGameMoves([position(0, null, 0), position(1, "a3", -30)], { inaccuracy: 25, mistake: 80, blunder: 160 })[0].classification, "Inaccuracy");
});

test("missing, incompatible, shallow, mate, and illegal-PV data remain unclassified", () => {
  assert.equal(classifyGameMoves([position(0, null, 0), { ...position(1, "a3", -300), analysis: null }], thresholds)[0].classification, null);
  assert.equal(classifyGameMoves([position(0, null, 0, "Nf3", 6), position(1, "a3", -300, "Nf3", 6)], thresholds)[0].classification, null);
  assert.equal(classifyGameMoves([position(0, null, 0), { ...position(1, "a3", -300), settings: "other" }], thresholds)[0].classification, null);
  assert.match(classifyGameMoves([position(0, null, 0, "Nf3", 12, "mate"), position(1, "a3", -300)], thresholds)[0].reason, /Mate scores/);
  assert.equal(classifyGameMoves([position(0, null, 0, "Qh9"), position(1, "a3", -300)], thresholds)[0].classification, null);
});

test("exceptional labels and Book are withheld without verified source evidence", () => {
  assert.equal(exceptionalMoveEligibility({ deepVerifiedMultiPv: false, corroboratedSacrifice: true, winningOnlyMove: true }).brilliant, false);
  assert.equal(exceptionalMoveEligibility({ deepVerifiedMultiPv: true, corroboratedSacrifice: true, winningOnlyMove: true }).great, false);
  const summary = summarizeClassifiedMoves([
    { ply: 1, san: "e4", color: "white", classification: "Best", lossCp: 0, evaluationBefore: 0, evaluationAfter: 0, bestMove: "e4", continuation: ["e4"], reason: "" },
    { ply: 2, san: "e5", color: "black", classification: "Blunder", lossCp: 250, evaluationBefore: 0, evaluationAfter: -2.5, bestMove: "Nf6", continuation: ["Nf6"], reason: "" },
    { ply: 3, san: "Nf3", color: "white", classification: "Inaccuracy", lossCp: 60, evaluationBefore: 1, evaluationAfter: .4, bestMove: "Bc4", continuation: ["Bc4"], reason: "" },
  ]);
  assert.equal(summary.byColor.white.Best, 1); assert.equal(summary.byColor.black.Blunder, 1);
  assert.equal(summary.critical.length, 2); assert.equal(summary.missedOpportunities.length, 2);
});

test("summary totals count every classified move by side without adding empty categories", () => {
  const moves = [
    { ply: 1, san: "e4", color: "white", classification: "Best" },
    { ply: 2, san: "e5", color: "black", classification: "Good" },
    { ply: 3, san: "Nf3", color: "white", classification: "Inaccuracy" },
  ];
  const summary = summarizeClassifiedMoves(moves);
  assert.equal(summary.byColor.white.Best, 1);
  assert.equal(summary.byColor.black.Good, 1);
  assert.equal(classifiedMoveCount(summary), 3);
});
