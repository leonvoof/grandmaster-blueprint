import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { MastersAuthorizationExpired } from "../lib/public-lichess-masters-auth.ts";
import { createMastersStatsLoader, formatMastersPercent, mastersPositionKey, parseMastersStats } from "../lib/public-masters-stats.ts";

const initial = DEFAULT_POSITION;
const e4 = new Chess();
e4.move("e4");
const d4 = new Chess();
d4.move("d4");
const root = {
  white: 45, draws: 30, black: 25, topGames: [],
  moves: [{ uci: "e2e4", san: "e4", white: 11, draws: 9, black: 10 }, { uci: "d2d4", san: "d4", white: 1, draws: 0, black: 0 }],
};
const empty = { white: 0, draws: 0, black: 0, moves: [], topGames: [] };
const connection = { token: "fixture_only", expiresAt: Date.now() + 3_600_000 };
const signal = () => new AbortController().signal;

test("uses the full sample for frequencies and the move sample for outcome percentages", () => {
  const stats = parseMastersStats(root, initial);
  assert.equal(stats.games, 100);
  assert.deepEqual(stats.moves.map(({ san, games, frequency }) => [san, games, formatMastersPercent(frequency)]), [
    ["e4", 30, "30.0%"], ["d4", 1, "1.0%"],
  ]);
  assert.deepEqual(stats.moves[0].results.map(formatMastersPercent), ["36.7%", "30.0%", "33.3%"]);
  assert.ok(Math.abs(stats.moves[0].results.reduce((a, b) => a + b) - 100) < 1e-9);
  assert.deepEqual(parseMastersStats(empty, initial), { games: 0, moves: [] });
  const blankMove = parseMastersStats({ ...empty, moves: [{ uci: "e2e4", san: "e4", white: 0, draws: 0, black: 0 }] }, initial);
  assert.equal(blankMove.moves[0].results, null);
});

test("validates supplied SAN and UCI, totals, and unique moves", () => {
  assert.throws(() => parseMastersStats(root, e4.fen()), /unexpected/);
  assert.throws(() => parseMastersStats({ ...root, white: -3 }, initial), /unexpected/);
  assert.throws(() => parseMastersStats({ ...root, white: 10 }, initial), /unexpected/);
  assert.throws(() => parseMastersStats({ ...root, moves: [root.moves[0], root.moves[0]] }, initial), /unexpected/);
  assert.throws(() => parseMastersStats({ ...root, moves: [{ ...root.moves[0], san: "e3" }] }, initial), /unexpected/);
});

test("cache ignores move counters, shares pending calls and requests the current FEN directly", async () => {
  const calls = [];
  const client = createMastersStatsLoader(connection, async (url, options) => {
    assert.equal(url.origin, "https://explorer.lichess.org");
    assert.equal(options.headers.Authorization, "Bearer fixture_only");
    assert.equal(url.searchParams.get("moves"), "12");
    calls.push(url.searchParams.get("fen"));
    return Response.json(calls.length === 1 ? root : empty);
  });
  const transposed = initial.replace("0 1", "4 3");
  const [first, second] = await Promise.all([client.load(initial, signal()), client.load(transposed, signal())]);
  assert.deepEqual(first, second);
  assert.deepEqual(await client.load(e4.fen(), signal()), { games: 0, moves: [] });
  assert.equal((await client.load(initial, signal())).games, 100);
  assert.deepEqual(calls, [initial, e4.fen()]);
  assert.notEqual(mastersPositionKey(initial), mastersPositionKey(initial.replace("KQkq", "-")));
  const ep = "rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3";
  assert.notEqual(mastersPositionKey(ep), mastersPositionKey(ep.replace("d6", "-")));
});

test("rapid navigation serializes requests and skips abandoned waiting positions", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const calls = [];
  const client = createMastersStatsLoader(connection, async (url) => {
    calls.push(url.searchParams.get("fen"));
    return calls.length === 1 ? pending : Response.json(empty);
  });
  const first = client.load(initial, signal());
  const abandoned = new AbortController();
  const superseded = client.load(e4.fen(), abandoned.signal);
  const skipped = assert.rejects(superseded, { name: "AbortError" });
  abandoned.abort();
  const current = client.load(d4.fen(), signal());
  assert.deepEqual(calls, [initial]);
  finish(Response.json(root));
  assert.equal((await current).games, 0);
  assert.equal((await first).games, 100);
  await skipped;
  assert.deepEqual(calls, [initial, d4.fen()]);
});

test("disconnect cancels requests, expired and rejected tokens block cache access, and network errors can retry", async () => {
  const client = createMastersStatsLoader(connection, async (_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  }));
  const pending = client.load(initial, signal());
  const disconnected = assert.rejects(pending, /Could not reach Lichess/);
  client.cancel();
  await disconnected;
  await assert.rejects(client.load(initial, signal()), { name: "AbortError" });

  let calls = 0;
  let now = Date.now();
  const retry = createMastersStatsLoader(connection, async () => {
    if (++calls === 1) throw new Error("offline");
    if (calls === 3) return new Response(null, { status: 401 });
    return Response.json(root);
  }, () => now);
  await assert.rejects(retry.load(initial, signal()), /Could not reach Lichess/);
  await retry.load(initial, signal());
  await assert.rejects(retry.load(e4.fen(), signal()), MastersAuthorizationExpired);
  await assert.rejects(retry.load(initial, signal()), MastersAuthorizationExpired);
  now = connection.expiresAt;
  const expired = createMastersStatsLoader(connection, async () => { throw Error("unexpected request"); }, () => now);
  await assert.rejects(expired.load(initial, signal()), MastersAuthorizationExpired);
  assert.equal(calls, 3);
});

test("a 429 pauses requests for the documented minute or longer Retry-After", async () => {
  let now = Date.now();
  let calls = 0;
  const client = createMastersStatsLoader(connection, async () => {
    if (++calls === 1) return new Response(null, { status: 429, headers: { "Retry-After": "75" } });
    return Response.json(empty);
  }, () => now);
  await assert.rejects(client.load(initial, signal()), /limiting requests/);
  now += 74_999;
  await assert.rejects(client.load(e4.fen(), signal()), /limiting requests/);
  assert.equal(calls, 1);
  now++;
  assert.equal((await client.load(e4.fen(), signal())).games, 0);
  assert.equal(calls, 2);
});
