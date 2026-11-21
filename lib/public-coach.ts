import { browserGameId, type SavedAnalysis } from "./browser-game-review.ts";
import { classifyEvaluationMove, MIN_CLASSIFICATION_DEPTH } from "./game-review-classification.ts";
import { connectedPlayerColor } from "./game-viewer-controls.ts";
import { openingMastery } from "./public-opening-reviews.ts";
import { tacticsFirstTryRate, validatedPgn, type PublicGame, type PublicProgress } from "./public-progress.ts";
import { ENGINE_BUILD, ENGINE_SETTINGS } from "./stockfish/engine.ts";
import type { Analysis } from "./stockfish/position.ts";

export const coachThresholds = { inaccuracy: 50, mistake: 100, blunder: 200 };

type CoachGame = { id: string; game: PublicGame };
export async function coachGames(entries: readonly PublicGame[]): Promise<CoachGame[]> {
  const games = await Promise.all(entries.filter(({ kind }) => kind === "game")
    .map(async (game) => ({ game, id: await browserGameId(game.pgn) })));
  const unique = new Map<string, CoachGame>();
  for (const entry of games) {
    if (!unique.has(entry.id) || (entry.game.source === "lichess" && entry.game.sourceUsername)) unique.set(entry.id, entry);
  }
  return [...unique.values()];
}

export function summarizeCoachTraining(progress: PublicProgress, now: number) {
  const attempts = progress.tacticsAttempts.filter((entry) => Date.parse(entry.timestamp) <= now)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const window = (start: number, end?: number) => {
    const segment = attempts.slice(start, end);
    const clean = segment.filter((attempt) => attempt.solved && !attempt.incorrectMove).length;
    return { attempted: segment.length, clean, rate: tacticsFirstTryRate({ attempted: segment.length, cleanSolved: clean }) };
  };
  const opening = { repertoires: progress.repertoires.length, due: 0, newPositions: 0, learning: 0, mastered: 0, successes: 0, failures: 0 };
  for (const repertoire of progress.repertoires) {
    const counts = openingMastery(repertoire, progress.openingReviews, now);
    opening.due += counts.due;
    opening.newPositions += counts.newPositions;
    opening.learning += counts.learning;
    opening.mastered += counts.mastered;
  }
  for (const review of progress.openingReviews) {
    opening.successes += review.successes;
    opening.failures += review.failures;
  }
  return {
    tactics: { ...progress.tacticsTotals, rate: tacticsFirstTryRate(progress.tacticsTotals), recent: window(-10), previous: window(-20, -10) },
    opening,
  };
}

function savedEvaluation(row: SavedAnalysis): Analysis {
  let variation: unknown;
  try { variation = JSON.parse(row.variation); } catch { variation = null; }
  return {
    engine: row.engine, depth: row.depth, bestMove: row.bestMove,
    score: !row.terminal && (row.scoreType === "cp" || row.scoreType === "mate") && Number.isSafeInteger(row.scoreValue)
      ? { kind: row.scoreType, value: row.scoreValue! } : null,
    variation: Array.isArray(variation) && variation.every((move) => typeof move === "string") && variation[0] === row.bestMove ? variation : [],
  };
}

export function summarizeCoachGames(games: readonly CoachGame[], saved: readonly SavedAnalysis[]) {
  const totals = { complete: 0, unattributed: 0, ownMoves: 0, assessed: 0, inaccuracies: 0, mistakes: 0, blunders: 0, affected: 0, seriousAffected: 0 };
  const depths = new Set<number>();
  const evidence: { title: string; issues: number }[] = [];
  const byGame = new Map<string, SavedAnalysis[]>();
  for (const row of saved) {
    if (row.engine !== ENGINE_BUILD || row.settings !== ENGINE_SETTINGS || !Number.isInteger(row.depth) || row.depth < MIN_CLASSIFICATION_DEPTH) continue;
    const list = byGame.get(row.gameId);
    if (list) list.push(row);
    else byGame.set(row.gameId, [row]);
  }
  for (const { id, game } of games) {
    const records = byGame.get(id);
    if (!records) continue;
    const chess = validatedPgn(game.pgn);
    const moves = chess.history({ verbose: true });
    const fens = [moves[0].before, ...moves.map(({ after }) => after)];
    const cohorts = new Map<number, Map<number, SavedAnalysis>>();
    for (const row of records) {
      if (fens[row.ply] !== row.fen) continue;
      const positions = cohorts.get(row.depth) ?? new Map<number, SavedAnalysis>();
      positions.set(row.ply, row);
      cohorts.set(row.depth, positions);
    }
    const depth = [...cohorts.keys()].filter((value) => cohorts.get(value)?.size === fens.length).sort((a, b) => b - a)[0];
    if (depth === undefined) continue;
    totals.complete++;
    const color = connectedPlayerColor(game.source === "lichess" ? game.sourceUsername ?? null : null, chess.getHeaders());
    if (!color) {
      totals.unattributed++;
      continue;
    }
    const positions = cohorts.get(depth)!;
    let issues = 0;
    let serious = 0;
    moves.forEach((move, ply) => {
      if (move.color !== color[0]) return;
      totals.ownMoves++;
      const label = classifyEvaluationMove({
        fen: move.before, played: move.san, before: savedEvaluation(positions.get(ply)!),
        after: savedEvaluation(positions.get(ply + 1)!), thresholds: coachThresholds,
      }).classification;
      if (!label) return;
      totals.assessed++;
      depths.add(depth);
      if (label === "Inaccuracy") { totals.inaccuracies++; issues++; }
      if (label === "Mistake") { totals.mistakes++; issues++; serious++; }
      if (label === "Blunder") { totals.blunders++; issues++; serious++; }
    });
    if (serious) totals.seriousAffected++;
    if (issues) {
      totals.affected++;
      evidence.push({ title: game.name, issues });
    }
  }
  return { ...totals, depths: [...depths].sort((a, b) => a - b), evidence: evidence.sort((a, b) => b.issues - a.issues).slice(0, 3) };
}

export type CoachPriority = { title: string; evidence: string; href: string; action: string };
export function coachPriorities(training: ReturnType<typeof summarizeCoachTraining>, games?: ReturnType<typeof summarizeCoachGames>): CoachPriority[] {
  const priorities: CoachPriority[] = [];
  if (training.opening.due >= 3) priorities.push({
    title: "Catch up on opening recall", evidence: `${training.opening.due} previously reviewed positions are due across your repertoires.`,
    href: "/openings", action: "Open My Repertoire to review",
  });
  if (games && games.assessed >= 12 && games.seriousAffected >= 2 && games.mistakes + games.blunders >= 3) priorities.push({
    title: "Revisit critical decisions", evidence: `${games.mistakes + games.blunders} mistakes or blunders in ${games.assessed} classified moves. Across ${games.seriousAffected} games with a mistake or blunder.`,
    href: "/games", action: "Open game review",
  });
  const { recent } = training.tactics;
  if (recent.attempted === 10 && recent.clean < 6) priorities.push({
    title: "Build consistency in tactics", evidence: `${recent.clean} of your last ${recent.attempted} puzzle attempts were solved without an incorrect move.`,
    href: "/tactics", action: "Practice tactics",
  });
  return priorities;
}
