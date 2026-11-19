import { DEFAULT_POSITION } from "chess.js";
import { createHash } from "node:crypto";
import { loadGameReplay } from "@/lib/game-replay";
import { lichessSiteId } from "@/lib/pgn";

export const timeControls = ["classical", "rapid", "blitz", "all"] as const;
export type TimeControl = (typeof timeControls)[number];
type Phase = "opening" | "middlegame" | "endgame";
type Color = "white" | "black";
type Cohort = { engine: string; settings: string; depth: number };
type SavedEvaluation = { id: string; ply: number; fen: string; scoreType: string | null; scoreValue: number | null } & Cohort;
export type WeaknessGame = {
  id: string; lichessId: string | null; lichessSpeed: string | null; lichessClock: unknown;
  opening: string | null; pgn: string; white: string; black: string;
  analyses: SavedEvaluation[];
};

const rules = { significantLossCp: 100, substantialAdvantageCp: 200, retainedAdvantageCp: 100, lowClockSeconds: 60 };
const finished = new Set(["1-0", "0-1", "1/2-1/2"]);
const normalize = (name: string) => name.trim().toLowerCase();

function phaseAt(fen: string, ply: number, standardStart: boolean): Phase {
  const weights: Record<string, number> = { q: 9, r: 5, b: 3, n: 3 };
  const material = [...fen.split(" ")[0]].reduce((sum, piece) => sum + (weights[piece.toLowerCase()] ?? 0), 0);
  if (material <= 26) return "endgame";
  return standardStart && ply <= 20 ? "opening" : "middlegame";
}

function clockReader(game: WeaknessGame, replay: ReturnType<typeof loadGameReplay>) {
  const clock = game.lichessClock as { centiseconds?: unknown; control?: { initial?: number } } | null;
  const times = clock?.centiseconds;
  const comments = new Map(replay.game.getComments().map(({ fen, comment }) => [fen, comment]));
  const simpleControl = replay.headers.TimeControl?.match(/^(\d+)(?:\+\d+)?$/);
  return (index: number): number | null => {
    const previous = index - 2;
    if (previous < 0) {
      const initial = clock?.control?.initial ?? (simpleControl ? Number(simpleControl[1]) : null);
      return typeof initial === "number" && Number.isFinite(initial) && initial > 0 ? initial : null;
    }
    const stored: unknown = Array.isArray(times) ? times[previous] : null;
    if (typeof stored === "number" && Number.isSafeInteger(stored) && stored >= 0) return stored / 100;
    const tag = comments.get(replay.moves[previous].fen)?.match(/\[%clk\s+(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)\]/);
    return tag ? Number(tag[1]) * 3600 + Number(tag[2]) * 60 + Number(tag[3]) : null;
  };
}

type Position = {
  gameId: string; ply: number; moveNumber: number; san: string; color: Color; phase: Phase;
  fen: string; afterFen: string; beforeAnalysisId: string; afterAnalysisId: string;
  beforeCp: number; afterCp: number; lossCp: number; clockBeforeSeconds: number | null;
};
type Group = {
  category: string; label: string; training: { module: string; action: string };
  eligible: number; positions: number; games: Set<string>; occurrences: Position[];
};
const metrics = (positions: number, eligible: number) => ({
  relevantPositions: positions, eligiblePositions: eligible,
  coverage: eligible ? positions / eligible : null,
});

function evaluateGame(game: WeaknessGame, player: string, cohort: Cohort) {
  const white = normalize(game.white) === player;
  const black = normalize(game.black) === player;
  if (white === black) return null;
  const color: Color = white ? "white" : "black";
  const turn = white ? "w" : "b";
  const sign = white ? 1 : -1;
  let replay;
  try { replay = loadGameReplay(game.pgn); } catch { return null; }
  if (!finished.has(replay.headers.Result) || !replay.moves.length
    || (replay.headers.Variant && !/^standard$/i.test(replay.headers.Variant))) return null;
  const evaluations = new Map(game.analyses
    .filter((row) => row.engine === cohort.engine && row.settings === cohort.settings && row.depth === cohort.depth
      && row.scoreType === "cp" && Number.isSafeInteger(row.scoreValue))
    .map((row) => [`${row.ply}:${row.fen}`, row]));
  const clockBefore = clockReader(game, replay);
  const moves = replay.moves.flatMap(({ san, fen: afterFen }, index) => {
    const fen = index === 0 ? replay.initialFen : replay.moves[index - 1].fen;
    const [, side, , , , moveNumber] = fen.split(" ");
    if (side !== turn) return [];
    const ply = index + 1;
    const phase = phaseAt(fen, ply, replay.initialFen === DEFAULT_POSITION);
    const seconds = clockBefore(index);
    const before = evaluations.get(`${index}:${fen}`);
    const after = evaluations.get(`${ply}:${afterFen}`);
    let position: Position | null = null;
    if (before?.scoreValue != null && after?.scoreValue != null) {
      const beforeCp = sign * before.scoreValue || 0;
      const afterCp = sign * after.scoreValue || 0;
      position = { gameId: game.id, ply, moveNumber: Number(moveNumber), san, color, phase, fen, afterFen,
        beforeAnalysisId: before.id, afterAnalysisId: after.id, beforeCp, afterCp, lossCp: beforeCp - afterCp, clockBeforeSeconds: seconds };
    }
    return [{ phase, seconds, position }];
  });
  const opening = game.opening?.trim() || replay.headers.Opening?.trim() || replay.headers.ECO?.trim();
  return {
    id: game.id, color, moves, opening: opening && !/^(?:\?|unknown|unclassified|\(unknown\))$/i.test(opening) ? opening : null,
    sourceId: game.lichessId || lichessSiteId(game.pgn),
    hash: createHash("sha256").update(game.pgn.trim().replace(/\s+/g, " ")).digest("hex"),
    compared: moves.filter(({ position }) => position).length,
  };
}

export function aggregateWeaknesses(games: WeaknessGame[], options: { player: string; timeControl: TimeControl; cohort: Cohort }) {
  const selected = games.filter((game) => options.timeControl === "all" || game.lichessSpeed === options.timeControl);
  const player = normalize(options.player);
  const examined = selected.flatMap((game) => {
    const result = player ? evaluateGame(game, player, options.cohort) : null;
    return result ? [result] : [];
  }).sort((a, b) => b.compared - a.compared || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const unique = examined.filter((game) => {
    const keys = [`id:${game.id}`, `pgn:${game.hash}`, ...(game.sourceId ? [`lichess:${game.sourceId}`] : [])];
    const duplicate = keys.some((key) => seen.has(key));
    keys.forEach((key) => seen.add(key));
    return !duplicate;
  });

  const groups = new Map<string, Group>();
  function group(category: string, label: string, module: string, action: string) {
    const key = JSON.stringify([category, label]);
    if (!groups.has(key)) groups.set(key, { category, label, training: { module, action }, eligible: 0, positions: 0, games: new Set(), occurrences: [] });
    return groups.get(key)!;
  }
  function record(bucket: Group, gameId: string, position: Position | null, occurrence = true) {
    bucket.eligible++;
    if (!position) return;
    bucket.positions++;
    bucket.games.add(gameId);
    if (occurrence && position.lossCp >= rules.significantLossCp) bucket.occurrences.push(position);
  }
  const overall = group("evaluation-loss", "Significant evaluation losses", "Analysis", "Replay the referenced positions and compare your move with the saved engine line.");
  const pressure = group("low-clock", "Losses with a low clock", "OTB Training", "Review these low-clock positions and practice decisions with a time budget.");
  const otherClock = group("other-clock", "Moves with at least 60 seconds", "OTB Training", "Use this group as a descriptive clock comparison.");
  const advantage = group("advantage-loss", "Substantial advantages lost", "Strategy", "Practice playing out the referenced positions from the side with the advantage.");
  const gameBreakdown = unique.map(({ id, color, moves, opening }) => {
    const perGame = group("game", id, "Analysis", "Review the referenced game.");
    const gamePhases = new Map<Phase, Group>();
    for (const { phase, seconds, position } of moves) {
      record(perGame, id, position);
      if (!gamePhases.has(phase)) {
        gamePhases.set(phase, { ...perGame, eligible: 0, positions: 0, games: new Set(), occurrences: [] });
      }
      record(gamePhases.get(phase)!, id, position);
      record(overall, id, position);
      record(group("color", color, "Analysis", `Review losses from your games as ${color}.`), id, position);
      const trainingModule = phase === "opening" ? "Openings" : phase === "endgame" ? "Endgames" : "Strategy";
      record(group("phase", phase, trainingModule, `Practice from the referenced ${phase} positions.`), id, position);
      if (phase === "opening" && opening) {
        record(group("opening", `${opening} as ${color}`, "Openings", "Review these specific positions in your opening study."), id, position);
      }
      if (seconds !== null) record(seconds < rules.lowClockSeconds ? pressure : otherClock, id, position);
      if (position && position.beforeCp >= rules.substantialAdvantageCp) {
        record(advantage, id, position, position.afterCp < rules.retainedAdvantageCp);
      }
    }
    return { gameId: id, color, opening, ...summarize(perGame), phases: [...gamePhases].map(([phase, bucket]) => ({ phase, ...summarize(bucket) })) };
  });

  const findings = [...groups.values()].filter(({ category }) => category !== "game").map((bucket) => {
    const summary = summarize(bucket);
    return {
      category: bucket.category, label: bucket.label, ...summary,
      supportingGameIds: [...new Set(bucket.occurrences.map(({ gameId }) => gameId))],
      positions: bucket.occurrences.sort((a, b) => b.lossCp - a.lossCp || a.gameId.localeCompare(b.gameId) || a.ply - b.ply),
      evidenceSummary: `${summary.occurrences} of ${summary.relevantPositions} comparable moves across ${summary.gamesWithEvidence} games. Losses occurred in ${summary.gamesWithOccurrences} distinct games.`,
      confidence: confidence(summary, options.cohort.depth),
      recommendedTraining: bucket.training,
    };
  });
  const priorities = findings.filter((finding) =>
    !["evaluation-loss", "other-clock"].includes(finding.category) && finding.confidence !== "insufficient")
    .sort((a, b) => Number(b.confidence === "moderate") - Number(a.confidence === "moderate")
      || b.gamesWithOccurrences - a.gamesWithOccurrences || b.occurrences - a.occurrences || (b.rate ?? 0) - (a.rate ?? 0)
      || Number(a.category === "color") - Number(b.category === "color") || a.label.localeCompare(b.label))
  const usedEvidence = new Set<string>();
  const topPriorities = priorities.filter(({ positions }) => {
    const key = JSON.stringify(positions.map(({ gameId, ply }) => [gameId, ply]));
    if (usedEvidence.has(key)) return false;
    usedEvidence.add(key);
    return true;
  }).slice(0, 3).map(({ category, label, recommendedTraining, evidenceSummary }) => ({
      category, label, recommendedTraining, reason: evidenceSummary,
    }));

  return {
    player: options.player, timeControl: options.timeControl, cohort: options.cohort, rules,
    status: !player ? "player-required" : topPriorities.length ? "supported-priorities" : "insufficient-evidence",
    evidence: {
      selectedRecords: selected.length, excludedRecords: selected.length - examined.length,
      duplicateRecords: examined.length - unique.length, gamesExamined: unique.length,
      ...summarize(overall), comparableMovesWithClock: pressure.positions + otherClock.positions,
    },
    limitations: [
      "Analysis is restricted to one engine, settings and depth. Missing, mate-only and mismatched positions are excluded from comparable move rates.",
      "Game phase is approximate. Reduced material (at most 26 total non-pawn piece points) takes precedence over the first 20 plies of a standard start.",
      "Opening groups use saved opening labels or PGN ECO and cover opening-phase moves only.",
      "Clock pressure uses the last recorded clock for the mover or the initial clock. Its association with losses is descriptive.",
      "Advantage-loss rates are conditional on comparable positions with at least +2.00 for the mover.",
      "Low confidence requires 3 games with evidence, 12 comparable moves, 3 losses across 2 games and 25% coverage. Moderate confidence requires 5 games, 30 comparable moves, losses in 4 games, 75% coverage and depth 12 or higher.",
      "Losses measure engine evaluation changes. They cannot establish a tactical motif, player intent or cause.",
      "Time-control filters use saved Lichess speed. All includes games with unknown speed. Game deduplication uses saved IDs, Lichess IDs and matching normalized PGNs.",
    ],
    priorityMethod: "Eligible categories need recurring losses and enough comparable positions. Priorities rank by confidence, distinct games with losses, occurrence count, then move rate. Groups with identical supporting positions are recommended once.",
    findings, gameBreakdown, priorities: topPriorities,
  };
}

function summarize(bucket: Group) {
  return {
    ...metrics(bucket.positions, bucket.eligible),
    gamesWithEvidence: bucket.games.size,
    gamesWithOccurrences: new Set(bucket.occurrences.map((item) => item.gameId)).size,
    occurrences: bucket.occurrences.length,
    rate: bucket.positions ? bucket.occurrences.length / bucket.positions : null,
    averageLossCp: bucket.occurrences.length
      ? Math.round(bucket.occurrences.reduce((sum, item) => sum + item.lossCp, 0) / bucket.occurrences.length) : null,
  };
}

function confidence(summary: ReturnType<typeof summarize>, depth: number) {
  if (summary.gamesWithEvidence < 3 || summary.relevantPositions < 12 || summary.occurrences < 3 || summary.gamesWithOccurrences < 2 || (summary.coverage ?? 0) < 0.25) return "insufficient";
  if (summary.gamesWithEvidence >= 5 && summary.relevantPositions >= 30 && summary.gamesWithOccurrences >= 4
    && (summary.coverage ?? 0) >= 0.75 && depth >= 12) return "moderate";
  return "low";
}
