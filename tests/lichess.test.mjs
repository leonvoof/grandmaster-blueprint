import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { lookupLichessUser, parseUsername, parseLichessGame, syncLichessGames } = await import("../lib/lichess.ts");
const { listSavedGames, saveLichessGame } = await import("../lib/games.ts");
const { loadGameReplay } = await import("../lib/game-replay.ts");
const { parsePgnCollection } = await import("../lib/pgn.ts");

function fixture(id, overrides = {}) {
  return {
    id, status: "resign", variant: "standard", speed: "classical", clocks: [180000, 179000],
    clock: { initial: 1800, increment: 0, totalTime: 1800 },
    opening: { name: "King's Pawn Game" },
    pgn: `[Event "Test fixture"]
[Site "https://lichess.org/game/${id}"]
[Date "2026.01.01"]
[White "Test White"]
[Black "Test Black"]
[WhiteElo "1800"]
[BlackElo "1810"]
[Result "1-0"]
[TimeControl "1800+0"]

1. e4 { [%clk 0:30:00] } e5 1-0`,
    ...overrides,
  };
}

test("validates usernames and loads available public ratings", async (t) => {
  assert.equal(parseUsername(" Example-User "), "example-user");
  for (const invalid of ["", "user/name", "../user", "white space", null]) {
    assert.throws(() => parseUsername(invalid), { status: 400 });
  }
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("/missing?")) return new Response(null, { status: 404 });
    assert.equal(url, "https://lichess.org/api/user/example-user?profile=false");
    return Response.json({ username: "Example-User", perfs: { classical: { rating: 1800 }, blitz: { rating: 1700 } } });
  });
  assert.deepEqual(await lookupLichessUser("example-user"), { username: "Example-User", classical: 1800, rapid: null, blitz: 1700 });
  await assert.rejects(lookupLichessUser("missing"), { status: 404 });
});

test("imports completed PGNs, skips ongoing games, and rejects invalid records", () => {
  const game = parseLichessGame(JSON.stringify(fixture("Test0001")), "classical");
  assert.equal(game.white, "Test White");
  assert.equal(game.black, "Test Black");
  assert.equal(game.date, "2026.01.01");
  assert.equal(game.result, "1-0");
  assert.equal(game.opening, "King's Pawn Game");
  assert.deepEqual(game.lichessClock.centiseconds, [180000, 179000]);
  assert.equal(parseLichessGame(JSON.stringify(fixture("Test0002", { status: "started" })), "classical"), null);
  assert.throws(() => parseLichessGame(JSON.stringify(fixture("Test0003", { pgn: "bad PGN" })), "classical"));
});

test("repeated sync skips fetched IDs and existing manual exports, and saved games reopen after reconnecting", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "blueprint-lichess-"));
  const file = join(directory, "test.db");
  const sqlite = new DatabaseSync(file);
  for (const migration of ["202611180001_baseline", "202611180002_game_fingerprint", "202611180003_lichess_sync"]) {
    const path = new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url);
    sqlite.exec(await readFile(path, "utf8"));
  }
  sqlite.close();

  let db = new PrismaClient({ datasourceUrl: `file:${file}` });
  try {
    const manualPgn = fixture("Test0001").pgn.replace("/game/", "/").replace(" { [%clk 0:30:00] }", "");
    const [manual] = parsePgnCollection(manualPgn);
    await db.chessGame.create({ data: manual });
    const records = [fixture("Test0001"), fixture("Test0002"), fixture("Test0003", { status: "started" })];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      const request = new URL(url);
      assert.equal(request.pathname, "/api/games/user/example-user");
      for (const [key, value] of Object.entries({ max: "10", perfType: "classical", finished: "true", ongoing: "false", clocks: "true", pgnInJson: "true" })) {
        assert.equal(request.searchParams.get(key), value);
      }
      assert.equal(options.headers.Accept, "application/x-ndjson");
      return new Response([...records.map((record) => JSON.stringify(record)), "invalid JSON"].join("\n"));
    });

    async function runSync() {
      const counts = { imported: 0, skipped: 0, failed: 0 };
      const updates = [];
      await syncLichessGames("example-user", "classical", 10, counts, () => updates.push({ ...counts }), (game) => saveLichessGame(game, db));
      assert.equal(updates.length, records.length + 1);
      return counts;
    }

    assert.deepEqual(await runSync(), { imported: 1, skipped: 2, failed: 1 });
    records[1].pgn = records[1].pgn.replace("0:30:00", "0:29:58");
    assert.deepEqual(await runSync(), { imported: 0, skipped: 3, failed: 1 });
    records.unshift(fixture("Test0004"));
    assert.deepEqual(await runSync(), { imported: 1, skipped: 3, failed: 1 });
    await db.lichessSettings.create({ data: { username: "Example-User", classical: 1800 } });
    await db.$disconnect();
    db = new PrismaClient({ datasourceUrl: `file:${file}` });
    const saved = await listSavedGames(db);
    assert.equal(saved.length, 3);
    assert.equal((await db.lichessSettings.findUnique({ where: { id: "local-player" } })).username, "Example-User");
    assert.equal(saved.find((game) => !game.lichessId).pgn, manualPgn);
    const imported = saved.find((game) => game.lichessId === "Test0002");
    assert.match(imported.pgn, /0:30:00/);
    const replay = loadGameReplay(imported.pgn);
    assert.equal(replay.headers.WhiteElo, "1800");
    assert.deepEqual(replay.moves.map(({ san }) => san), ["e4", "e5"]);
    assert.equal(replay.moves.at(-1).fen, replay.game.fen());
  } finally {
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});

test("serializes upstream requests and enforces the rate-limit cooldown", async (t) => {
  let finish;
  const upstream = new Promise((resolve) => { finish = resolve; });
  const fetchMock = t.mock.method(globalThis, "fetch", () => upstream);
  const pending = lookupLichessUser("example-user");
  await assert.rejects(lookupLichessUser("another-user"), { status: 409 });
  finish(new Response(null, { status: 429 }));
  await assert.rejects(pending, { status: 429, retryAfter: 60 });
  await assert.rejects(lookupLichessUser("another-user"), { status: 429 });
  assert.equal(fetchMock.mock.callCount(), 1);
});
