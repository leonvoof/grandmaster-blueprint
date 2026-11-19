import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { withIsolatedDb } from "./isolated-db.mjs";

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier.startsWith("@/") ? nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context) : nextResolve(specifier, context);
} });
const { aggregateWeaknesses } = await import("../lib/weakness-analysis.ts");
const { getWeaknessReport } = await import("../lib/weakness-report.ts");
const { loadGameReplay } = await import("../lib/game-replay.ts");
const { ENGINE_BUILD, ENGINE_SETTINGS } = await import("../lib/stockfish/engine.ts");
const cohort = { engine: ENGINE_BUILD, settings: ENGINE_SETTINGS, depth: 12 };
const options = { player: "ALICE", timeControl: "classical", cohort };

function fixture(id, { black = false, result = "1/2-1/2", speed = "classical", clocks = false } = {}) {
  const names = black ? ["Bob", "Alice"] : ["Alice", "Bob"];
  const pgn = `[Event "Test fixture ${id}"]\n[White "${names[0]}"]\n[Black "${names[1]}"]\n[Result "${result}"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 ${result}`;
  const replay = loadGameReplay(pgn);
  const analyses = [replay.initialFen, ...replay.moves.map(({ fen }) => fen)].map((fen, ply) => ({
    ...cohort, id: `${id}-${ply}`, ply, fen, scoreType: "cp",
    scoreValue: ply % 2 === 0 ? 240 : 20,
  }));
  return {
    id, pgn, white: names[0], black: names[1], opening: "Ruy Lopez", lichessId: null, lichessSpeed: speed,
    lichessClock: clocks ? { control: { initial: 900 }, centiseconds: [5500, 7000, 4500, 6500] } : null,
    analyses,
  };
}

test("attributes cp losses to the selected mover and links exact pre/post positions", () => {
  const white = fixture("w", { clocks: true });
  const black = fixture("b", { black: true, clocks: true });
  const report = aggregateWeaknesses([white, black], options);
  const overall = report.findings.find((item) => item.category === "evaluation-loss");
  const blackFirst = overall.positions.find((item) => item.gameId === "b" && item.ply === 2);
  assert.equal(blackFirst.san, "e5");
  assert.equal(blackFirst.moveNumber, 1);
  assert.equal(blackFirst.beforeCp, -20);
  assert.equal(blackFirst.afterCp, -240);
  assert.equal(blackFirst.beforeAnalysisId, "b-1");
  assert.equal(blackFirst.afterAnalysisId, "b-2");
  assert.equal(blackFirst.fen, black.analyses[1].fen);
  assert.equal(blackFirst.afterFen, black.analyses[2].fen);
  assert.equal(overall.occurrences, 12);
  const lowClock = report.findings.find((item) => item.category === "low-clock");
  assert.deepEqual(lowClock.positions.map(({ ply, clockBeforeSeconds }) => [ply, clockBeforeSeconds]), [[3, 55], [5, 45]]);
  assert.deepEqual(report.findings.find((item) => item.category === "advantage-loss").supportingGameIds, ["w"]);
  assert.equal(report.priorities.length, 0);
});

test("reports recurring trends across distinct games and deduplicates known exports", () => {
  const games = Array.from({ length: 5 }, (_, i) => fixture(String(i)));
  const duplicate = { ...games[0], id: "duplicate", analyses: [] };
  const duplicateById = { ...fixture("alternate"), lichessId: "abcdefgh", analyses: [] };
  games[0].pgn = games[0].pgn.replace('\n[White', '\n[Site "https://lichess.org/abcdefgh"]\n[White');
  duplicate.pgn = games[0].pgn;
  const report = aggregateWeaknesses([...games, duplicate, duplicateById, fixture("other-speed", { speed: "blitz" })], options);
  assert.equal(report.evidence.gamesExamined, 5);
  assert.equal(report.evidence.duplicateRecords, 2);
  assert.equal(report.evidence.occurrences, 30);
  assert.equal(report.evidence.coverage, 1);
  assert.equal(report.evidence.comparableMovesWithClock, 0);
  assert.ok(report.priorities.length > 0 && report.priorities.length <= 3);
  assert.ok(report.priorities.some((priority) => priority.recommendedTraining.module === "Openings"));
  assert.equal(aggregateWeaknesses(games, { ...options, player: "Someone else" }).evidence.gamesExamined, 0);
});

test("excludes unfinished games, missing pairs, mate scores and incompatible or misaligned results", () => {
  const partial = fixture("partial");
  partial.analyses[0].scoreType = "mate";
  partial.analyses[2].depth = 14;
  partial.analyses[5].settings = "other";
  partial.analyses[6].fen = partial.analyses[8].fen;
  partial.analyses = partial.analyses.filter(({ ply }) => ply <= 10);
  const report = aggregateWeaknesses([partial, fixture("ongoing", { result: "*" })], options);
  assert.equal(report.evidence.gamesExamined, 1);
  assert.equal(report.evidence.eligiblePositions, 6);
  assert.equal(report.evidence.relevantPositions, 1);
  assert.equal(report.evidence.comparableMovesWithClock, 0);
  assert.equal(report.status, "insufficient-evidence");
});

test("database reports reflect newly saved analysis without mixing depths or refreshing a cache", () => withIsolatedDb(async (db) => {
  assert.equal((await getWeaknessReport({}, db)).status, "player-required");
  await db.lichessSettings.create({ data: { username: "alice" } });
  const { analyses, ...game } = fixture("db");
  await db.chessGame.create({ data: { ...game, lichessClock: undefined } });
  assert.equal((await getWeaknessReport({}, db)).evidence.relevantPositions, 0);
  await db.gameAnalysis.createMany({ data: analyses.map((analysis) => ({ ...analysis, gameId: game.id, variation: "[]" })) });
  assert.equal((await getWeaknessReport({}, db)).evidence.relevantPositions, 6);
  assert.equal((await getWeaknessReport({ depth: 14 }, db)).evidence.relevantPositions, 0);
  assert.equal((await getWeaknessReport({ timeControl: "rapid" }, db)).evidence.gamesExamined, 0);
  assert.equal((await getWeaknessReport({}, db)).priorities.length, 0);
  for (const id of ["db-two", "db-three"]) {
    const { analyses: rows, ...savedGame } = fixture(id);
    await db.chessGame.create({ data: { ...savedGame, lichessClock: undefined } });
    await db.gameAnalysis.createMany({ data: rows.map((row) => ({ ...row, gameId: id, variation: "[]" })) });
  }
  assert.equal((await getWeaknessReport({}, db)).status, "supported-priorities");
}));

test("uses side-to-move and move number from the actual endgame position", () => {
  const game = fixture("endgame", { black: true });
  game.pgn = '[Event "Test fixture"]\n[White "Bob"]\n[Black "Alice"]\n[SetUp "1"]\n[FEN "4k3/7p/8/8/8/8/P7/4K3 b - - 0 35"]\n[Result "1/2-1/2"]\n\n35... h5 36. a4 h4 1/2-1/2';
  const replay = loadGameReplay(game.pgn);
  game.analyses = [replay.initialFen, ...replay.moves.map(({ fen }) => fen)].map((fen, ply) => ({
    ...cohort, id: `end-${ply}`, ply, fen, scoreType: "cp", scoreValue: [0, 140, 0, 0][ply],
  }));
  const report = aggregateWeaknesses([game], options);
  const phase = report.findings.find((item) => item.category === "phase");
  assert.equal(phase.label, "endgame");
  assert.equal(phase.relevantPositions, 2);
  assert.deepEqual(phase.positions.map(({ moveNumber, color, san }) => [moveNumber, color, san]), [[35, "black", "h5"]]);
  assert.equal(report.findings.some((item) => item.category === "opening"), false);
});

test("uses the previous same-side PGN clock when JSON clock samples are missing", () => {
  const game = fixture("pgn-clock");
  game.pgn = game.pgn.replace("e4 e5", "e4 {[%clk 0:00:42]} e5 {[%clk 0:14:03]}");
  const report = aggregateWeaknesses([game], options);
  const lowClock = report.findings.find((item) => item.category === "low-clock");
  assert.deepEqual(lowClock.positions.map(({ ply, clockBeforeSeconds }) => [ply, clockBeforeSeconds]), [[3, 42]]);
  assert.equal(report.evidence.comparableMovesWithClock, 1);
});
