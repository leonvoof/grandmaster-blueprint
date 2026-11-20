import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLichessExportUrl, getLichessCooldown, mergeLichessGames,
  parseLichessPgnExport, requestPublicLichessGames, splitLichessPgnExport,
  validatePublicLichessUsername, withSingleLichessImport,
} from "../lib/public-lichess.ts";
import { decodeProgress, readProgress, saveProgress, maxGames, maxBackupBytes } from "../lib/public-progress.ts";

const pgn = (id, result = "1-0", moveText = "1. e4 e5 2. Nf3 Nc6 1-0") => `[Event "Rated classical game"]
[Site "https://lichess.org/${id}"]
[Date "2024.01.02"]
[UTCDate "2024.01.02"]
[White "Alice"]
[Black "Bob"]
[Result "${result}"]

${moveText}`;

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("validates usernames and builds bounded official export URLs", () => {
  assert.equal(validatePublicLichessUsername("  chess_user-2 "), "chess_user-2");
  for (const username of ["", "a", "bad/name", "user name", "x".repeat(31)]) assert.throws(() => validatePublicLichessUsername(username), /Lichess username/);
  const url = buildLichessExportUrl("Alice", "all", 50);
  assert.equal(url.origin, "https://lichess.org");
  assert.equal(url.pathname, "/api/games/user/Alice");
  assert.equal(url.searchParams.get("max"), "50");
  assert.equal(url.searchParams.get("perfType"), "ultraBullet,bullet,blitz,rapid,classical,correspondence");
  assert.equal(url.searchParams.get("sort"), "dateDesc");
  assert.equal(url.searchParams.get("finished"), "true");
  assert.equal(url.searchParams.get("ongoing"), "false");
  assert.equal(buildLichessExportUrl("Alice", "classical", 10).searchParams.get("perfType"), "classical");
  assert.equal(buildLichessExportUrl("Alice", "rapid", 25).searchParams.get("perfType"), "rapid");
  assert.equal(buildLichessExportUrl("Alice", "blitz", 100).searchParams.get("perfType"), "blitz");
  assert.throws(() => buildLichessExportUrl("Alice", "all", 101));
});

test("splits and validates multiple PGNs, keeps metadata and counts malformed games", () => {
  const combined = `${pgn("AbCd1234")}\n\n${pgn("EfGh5678", "0-1", "1. d4 d5 2. c4 e6 0-1")}\n\n[Event "bad"]\n\n1. e5`;
  const chunks = splitLichessPgnExport(combined);
  assert.equal(chunks.length, 3);
  const parsed = parseLichessPgnExport(combined, "Alice", 10);
  assert.equal(parsed.total, 3);
  assert.equal(parsed.games.length, 2);
  assert.equal(parsed.invalid, 1);
  assert.equal(parsed.games[0].sourceId, "AbCd1234");
  assert.equal(parsed.games[0].sourceUsername, "Alice");
  assert.equal(parsed.games[0].name, "Alice vs Bob · 2024-01-02");
  assert.equal(parsed.games[1].pgn.includes("1. d4"), true);
  assert.equal(parseLichessPgnExport("", "Alice", 10).total, 0);
  const bounded = parseLichessPgnExport(`${pgn("AbCd1234")}\n\n${pgn("EfGh5678")}\n\n${pgn("IjKl9012")}`, "Alice", 2);
  assert.equal(bounded.games.length, 2);
  assert.equal(bounded.overLimit, 1);
});

test("deduplicates by Lichess ID and normalized PGN while preserving unrelated saved games", () => {
  const old = { kind: "game", name: "manual", pgn: pgn("AbCd1234") };
  const incoming = parseLichessPgnExport(`${pgn("AbCd1234", "1-0", "1. e4   e5 2. Nf3 Nc6 1-0")}\n\n${pgn("EfGh5678")}`, "Alice", 10).games;
  const merged = mergeLichessGames([old], incoming);
  assert.equal(merged.imported, 1);
  assert.equal(merged.duplicates, 1);
  assert.equal(merged.games.length, 2);
  assert.equal(merged.games[0], old);
  assert.equal(merged.games[1].sourceId, "EfGh5678");
  const sameWithoutId = { kind: "game", name: "saved", pgn: "1. e4 e5 2. Nf3 Nc6 1-0" };
  const noIdCandidate = parseLichessPgnExport("1. e4 e5 2. Nf3 Nc6 1-0", "Alice", 10).games;
  assert.equal(mergeLichessGames([sameWithoutId], noIdCandidate).duplicates, 1);
});

test("direct request is anonymous, bounded, persists 429 cooldown, and handles empty/error responses", async () => {
  const store = storage();
  let request;
  const successful = await requestPublicLichessGames({
    username: "Alice", timeControl: "rapid", limit: 10, storage: store, existing: [], now: () => 1234,
    fetcher: async (url, options) => {
      request = { url, options };
      return new Response(pgn("AbCd1234"), { status: 200, headers: { "content-type": "application/x-chess-pgn" } });
    },
  });
  assert.equal(successful.imported, 1);
  assert.equal(new URL(request.url).searchParams.get("max"), "10");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.headers.Authorization, undefined);
  const empty = await requestPublicLichessGames({ username: "Alice", timeControl: "all", limit: 10, storage: store, existing: [], fetcher: async () => new Response("", { status: 200, headers: { "content-type": "application/x-chess-pgn" } }) });
  assert.equal(empty.returned, 0);
  await assert.rejects(() => requestPublicLichessGames({ username: "Alice", timeControl: "all", limit: 10, storage: store, existing: [], fetcher: async () => new Response("", { status: 404 }) }), { code: "not-found" });
  await assert.rejects(() => requestPublicLichessGames({ username: "Alice", timeControl: "all", limit: 10, storage: store, existing: [], now: () => 5000, fetcher: async () => new Response("", { status: 429 }) }), { code: "rate-limited" });
  assert.equal(getLichessCooldown(store, 64_999), 65_000);
  assert.equal(getLichessCooldown(store, 65_000), 0);
  await assert.rejects(() => requestPublicLichessGames({ username: "Alice", timeControl: "all", limit: 10, storage: store, existing: [], now: () => 6000, fetcher: async () => new Response("", { status: 200 }) }), { code: "cooldown" });
  let called = false;
  await assert.rejects(() => requestPublicLichessGames({ username: "bad/name", timeControl: "all", limit: 10, storage: store, existing: [], fetcher: async () => { called = true; return new Response(); } }), { code: "invalid-username" });
  assert.equal(called, false);
  await assert.rejects(() => requestPublicLichessGames({ username: "Alice", timeControl: "all", limit: 10, storage: storage(), existing: [], fetcher: async () => { throw new TypeError("Failed to fetch"); } }), { code: "network" });
});

test("browser storage retains imported game metadata across reload and JSON backup", () => {
  const first = storage();
  const imported = parseLichessPgnExport(pgn("AbCd1234"), "Alice", 10).games[0];
  const initial = readProgress(first);
  const saved = saveProgress(first, { ...initial, games: [imported] });
  const reopened = readProgress(first);
  assert.deepEqual(reopened.games, saved.games);
  const restored = decodeProgress(JSON.stringify(reopened));
  assert.equal(restored.games[0].source, "lichess");
  assert.equal(restored.games[0].sourceId, "AbCd1234");
  assert.ok(maxGames >= 100);
  assert.ok(maxBackupBytes >= 1_000_000);
});

test("only one import can run at a time", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = withSingleLichessImport(() => gate);
  await assert.rejects(() => withSingleLichessImport(async () => "unexpected"), { code: "busy" });
  release("finished");
  assert.equal(await first, "finished");
});
