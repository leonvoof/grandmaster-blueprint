import assert from "node:assert/strict";
import { test } from "node:test";
import { withIsolatedDb } from "./isolated-db.mjs";
import { loadPersonalExplorerData } from "../lib/opening-explorer-db.ts";
import {
  buildPersonalExplorerStats, buildRepertoireContinuations, clearExplorerCache,
  fetchRemoteExplorer, mergeExplorerMoves, normalizeRemoteExplorer, validateExplorerFen,
} from "../lib/opening-explorer.ts";

const initialFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const personalGames = [
  { id: "1", fingerprint: "one", opening: "Sicilian Defense", result: "1-0", pgn: '[Event "x"]\n[Opening "Sicilian Defense"]\n[Result "1-0"]\n\n1. e4 c5 *' },
  { id: "2", fingerprint: "two", opening: "Open Game", result: "1/2-1/2", pgn: '[Event "y"]\n[Opening "Open Game"]\n[Result "1/2-1/2"]\n\n1. e4 e5 *' },
  { id: "duplicate", fingerprint: "one", opening: "Sicilian Defense", result: "1-0", pgn: '[Event "x"]\n[Opening "Sicilian Defense"]\n[Result "1-0"]\n\n1. e4 c5 *' },
  { id: "3", fingerprint: "three", opening: "Queen Pawn", result: "0-1", pgn: '[Event "z"]\n[Opening "Queen Pawn"]\n[Result "0-1"]\n\n1. d4 d5 *' },
];

test("personal explorer counts unique saved games by legal continuation and result", () => {
  const result = buildPersonalExplorerStats(initialFen, personalGames);
  assert.equal(result.source, "personal");
  assert.equal(result.totalGames, 3);
  assert.equal(result.white, 1);
  assert.equal(result.draws, 1);
  assert.equal(result.black, 1);
  assert.deepEqual(result.moves.map(({ san, games, frequency }) => [san, games, frequency]), [["e4", 2, 2 / 3], ["d4", 1, 1 / 3]]);
  assert.equal(result.moves[0].white, 1);
  assert.equal(result.moves[0].draws, 1);
  assert.equal(result.moves[0].openingName, "Open Game");
});

test("custom FEN position lookup and repertoire membership are position-specific", () => {
  const customFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
  const line = { pgn: `[SetUp "1"]\n[FEN "${customFen}"]\n[Result "*"]\n\n1... c5 2. Nf3 *`, repertoireId: "rep", chapterId: "ch", repertoireName: "All openings", chapterName: "Custom", lineName: "Line" };
  const choices = buildRepertoireContinuations(customFen, [line]);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].san, "c5");
  assert.deepEqual(choices[0].lines[0], { repertoireId: "rep", chapterId: "ch", repertoireName: "All openings", chapterName: "Custom", lineName: "Line" });
  assert.equal(buildRepertoireContinuations(initialFen, [line]).length, 0);
  assert.equal(validateExplorerFen(customFen)?.split(" ")[1], "b");
  assert.equal(validateExplorerFen("not-a-fen"), null);
});

test("provider moves are chess.js validated and repertoire-only candidates are not given game statistics", () => {
  const stats = normalizeRemoteExplorer("lichess", initialFen, {
    opening: { name: "Initial Position", eco: "A00" }, white: 6, draws: 2, black: 2,
    moves: [
      { uci: "e2e4", white: 3, draws: 1, black: 1, averageRating: 1800, opening: { name: "Open Game" } },
      { uci: "e2e5", white: 9, draws: 9, black: 9 },
    ],
  });
  assert.equal(stats.source, "lichess");
  assert.equal(stats.moves.length, 1);
  assert.equal(stats.moves[0].san, "e4");
  assert.equal(stats.moves[0].games, 5);
  assert.equal(stats.moves[0].frequency, 0.5);
  const merged = mergeExplorerMoves(initialFen, stats.moves, [{ uci: "d2d4", lines: [] }]);
  const repertoireOnly = merged.find((move) => move.san === "d4");
  assert.deepEqual([repertoireOnly.games, repertoireOnly.frequency, repertoireOnly.inRepertoire], [0, 0, true]);
});

test("remote explorer requires server credentials and reports authentication failures without leaking details", async () => {
  clearExplorerCache();
  const missing = await fetchRemoteExplorer({ source: "masters", fen: initialFen, filters: {} });
  assert.equal(missing.status, 503);
  assert.match(missing.error, /LICHESS_API_TOKEN/);
  const rejected = await fetchRemoteExplorer({ source: "lichess", fen: initialFen, filters: {}, token: "secret-token", fetcher: async () => new Response("private detail", { status: 401 }) });
  assert.equal(rejected.status, 401);
  assert.doesNotMatch(rejected.error, /private detail|secret-token/);
});

test("remote rate limits surface Retry-After without caching a failed response", async () => {
  clearExplorerCache();
  let calls = 0;
  const fetcher = async () => { calls++; return new Response("slow down", { status: 429, headers: { "Retry-After": "60" } }); };
  const input = { source: "masters", fen: initialFen, filters: {}, token: "server-token", fetcher };
  const first = await fetchRemoteExplorer(input);
  const second = await fetchRemoteExplorer(input);
  assert.equal(first.status, 429);
  assert.equal(first.retryAfter, "60");
  assert.equal(second.status, 429);
  assert.equal(calls, 2);
});

test("remote responses cache by source, position, and compatible filters for one minute", async () => {
  clearExplorerCache();
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({ white: 2, draws: 1, black: 1, moves: [{ uci: "e2e4", white: 1, draws: 1, black: 0 }] }); };
  const input = { source: "lichess", fen: initialFen, filters: { speeds: "classical", ratings: "1800" }, token: "local-secret", fetcher, now: 1000 };
  const first = await fetchRemoteExplorer(input);
  const cached = await fetchRemoteExplorer({ ...input, now: 2000 });
  const differentSource = await fetchRemoteExplorer({ ...input, source: "masters", now: 2000 });
  assert.equal(first.cached, false);
  assert.equal(cached.cached, true);
  assert.equal(differentSource.cached, false);
  assert.equal(calls, 2);
});

test("isolated SQLite explorer combines filtered personal games with separate saved repertoire continuations", () => withIsolatedDb(async (db) => {
  const repertoire = await db.openingRepertoire.create({ data: { name: "Custom repertoire", side: "White" } });
  const chapter = await db.openingChapter.create({ data: { repertoireId: repertoire.id, name: "Custom chapter" } });
  await db.openingLine.create({ data: { chapterId: chapter.id, name: "Saved d4", pgn: "1. d4 d5 *" } });
  await db.chessGame.create({ data: { white: "A", black: "B", date: "2024.03.12", result: "1-0", opening: "Open Game", pgn: '[Event "one"]\n[Result "1-0"]\n\n1. e4 e5 *', fingerprint: "isolated-one", lichessSpeed: "classical" } });
  await db.chessGame.create({ data: { white: "C", black: "D", date: "2024.03.13", result: "1/2-1/2", opening: "Open Game", pgn: '[Event "two"]\n[Result "1/2-1/2"]\n\n1. e4 c5 *', fingerprint: "isolated-two", lichessSpeed: "rapid" } });
  const result = await loadPersonalExplorerData(db, initialFen, { since: "2024-03", until: "2024-03", speed: "classical" });
  assert.equal(result.totalGames, 1);
  assert.equal(result.moves[0].san, "e4");
  assert.equal(result.moves[0].white, 1);
  assert.equal(result.repertoireMoves[0].san, "d4");
  assert.deepEqual(result.repertoireMoves[0].lines[0].repertoireId, repertoire.id);
  assert.equal(result.gameRecordsExamined, 1);
}));
