import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { runStockfish } from "../lib/stockfish/engine.ts";
import { analyzePositionsSequentially } from "../lib/full-game-analysis.ts";
import { analysisPosition, parseUciInfo, uciVariationToSan } from "../lib/stockfish/position.ts";

function fakeWorker() {
  return {
    sent: [],
    stopped: false,
    postMessage(command) { this.sent.push(command); },
    terminate() { this.stopped = true; },
    receive(data) { this.onmessage?.({ data }); },
  };
}

function start(fen, worker, controller = new AbortController()) {
  return runStockfish(fen, 6, controller.signal, () => {}, () => worker);
}

function ready(worker) {
  worker.receive("id name Test fixture\nuciok");
  worker.receive("readyok");
}

test("waits for UCI and readiness before setting the position and searching", async () => {
  const worker = fakeWorker();
  const pending = start(DEFAULT_POSITION, worker);
  assert.deepEqual(worker.sent, ["uci"]);
  worker.receive("readyok");
  assert.deepEqual(worker.sent, ["uci"]);
  worker.receive("id name Test fixture\nuciok");
  assert.deepEqual(worker.sent.slice(1), ["setoption name Hash value 16", "setoption name MultiPV value 1", "isready"]);
  worker.receive("readyok");
  assert.deepEqual(worker.sent.slice(-2), [`position fen ${DEFAULT_POSITION}`, "go depth 6"]);
  worker.receive("info depth 6 score cp 22 multipv 1 pv e2e4 e7e5\nbestmove e2e4");
  assert.deepEqual(await pending, {
    engine: "Test fixture", depth: 6, score: { kind: "cp", value: 22 }, bestMove: "e4", variation: ["e4", "e5"],
  });
  assert.equal(worker.stopped, true);
});

test("parses exact White-perspective centipawn and mate scores", () => {
  assert.deepEqual(parseUciInfo("info depth 10 score cp 30 pv e7e5", false)?.score, { kind: "cp", value: -30 });
  assert.deepEqual(parseUciInfo("info depth 10 score mate -3 pv e7e5", false)?.score, { kind: "mate", value: 3 });
  assert.deepEqual(parseUciInfo("info depth 10 score mate 1 pv e7e5", false)?.score, { kind: "mate", value: -1 });
  assert.equal(parseUciInfo("info depth 9 score cp 12 upperbound pv e2e4", true), null);
  assert.equal(parseUciInfo("info depth 9 multipv 2 score cp 12 pv e2e4", true), null);
  assert.equal(parseUciInfo("info string NNUE loaded", true), null);
});

test("converts legal variations to SAN and rejects illegal sequences", () => {
  assert.deepEqual(uciVariationToSan(DEFAULT_POSITION, ["e2e4", "e7e5", "g1f3"]), ["e4", "e5", "Nf3"]);
  assert.throws(() => uciVariationToSan(DEFAULT_POSITION, ["e2e4", "e4e5"]));
  assert.deepEqual(uciVariationToSan("7k/P7/8/8/8/8/8/7K w - - 0 1", ["a7a8q"]), ["a8=Q+"]);
});

test("recognizes checkmate and draws on the board without starting a worker", async () => {
  const neverCreate = () => { assert.fail("Terminal positions should not start an engine"); };
  const run = (fen) => runStockfish(fen, 6, new AbortController().signal, () => {}, neverCreate);
  const mate = await run("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(mate.terminal, "Black is checkmated");
  assert.equal(mate.bestMove, null);
  assert.equal(mate.depth, 0);
  const stalemate = await run("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(stalemate.terminal, "Stalemate");
  assert.deepEqual(stalemate.score, { kind: "cp", value: 0 });
  assert.equal((await run("7k/8/6K1/8/8/8/8/8 b - - 0 1")).terminal, "Insufficient material");
  assert.equal((await run("7k/5Q2/6K1/8/8/8/8/8 w - - 150 80")).terminal, "75-move rule");
});

test("cancels and discards late output as the selected position changes", async () => {
  const chess = new Chess();
  for (const move of ["e4", "e5", "Nf3"]) {
    const controller = new AbortController();
    const worker = fakeWorker();
    const pending = start(chess.fen(), worker, controller);
    ready(worker);
    const lateOutput = worker.onmessage;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.ok(worker.stopped);
    lateOutput({ data: "info depth 6 score cp 22 pv e2e4\nbestmove e2e4" });
    chess.move(move);
  }
  const worker = fakeWorker();
  const restarted = start(chess.fen(), worker);
  ready(worker);
  assert.equal(worker.sent.at(-2), `position fen ${chess.fen()}`);
  worker.receive("info depth 6 score cp 10 pv b8c6\nbestmove b8c6");
  assert.equal((await restarted).bestMove, "Nc6");
});

test("rejects illegal positions and releases resources on engine failure", async () => {
  assert.throws(() => analysisPosition("not a FEN"), /valid FEN/);
  assert.throws(() => analysisPosition("7k/7Q/6K1/8/8/8/8/8 w - - 0 1"), /illegal/);
  const worker = fakeWorker();
  const pending = start(DEFAULT_POSITION, worker);
  worker.onerror({ preventDefault() {} });
  await assert.rejects(pending, /could not start/);
  assert.equal(worker.stopped, true);
  const malformed = fakeWorker();
  const noPv = start(DEFAULT_POSITION, malformed);
  ready(malformed);
  malformed.receive("bestmove (none)");
  await assert.rejects(noPv, /complete line/);
  assert.ok(malformed.stopped);
});

function wasmProcess() {
  const script = fileURLToPath(new URL("../node_modules/stockfish/bin/stockfish-19-lite-single.js", import.meta.url));
  const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"] });
  const output = createInterface({ input: child.stdout });
  const worker = {
    postMessage(command) { child.stdin.write(`${command}\n`); },
    terminate() { output.close(); child.kill(); },
  };
  output.on("line", (data) => worker.onmessage?.({ data }));
  child.on("error", () => worker.onerror?.({ preventDefault() {} }));
  child.on("exit", () => worker.onerror?.({ preventDefault() {} }));
  return worker;
}

test("runs the packaged Stockfish WASM on a valid position and a Black mate in one", async () => {
  const run = (fen) => runStockfish(fen, 6, AbortSignal.timeout(10_000), () => {}, wasmProcess);
  const first = await run(DEFAULT_POSITION);
  assert.match(first.engine, /Stockfish 19/);
  assert.equal(first.depth, 6);
  assert.equal(first.score.kind, "cp");
  assert.equal(first.bestMove, first.variation[0]);
  const mate = await run("8/8/8/8/8/6k1/5q2/7K b - - 0 1");
  assert.deepEqual(mate.score, { kind: "mate", value: -1 });
  assert.match(mate.bestMove, /#$/);
});

test("analyzes game positions in order, reuses saved positions, resumes, and cancels safely", async () => {
  const positions = [{ ply: 0, fen: "start", san: null }, { ply: 1, fen: "after-e4", san: "e4" }, { ply: 2, fen: "after-e5", san: "e5" }];
  const stored = new Map([["0", { score: { kind: "cp", value: 3 } }]]);
  const sequence = [];
  const controller = new AbortController();
  let completed = 0;
  const count = await analyzePositionsSequentially({
    positions, signal: controller.signal,
    load: async (position) => stored.get(String(position.ply)) ?? null,
    analyze: async (position) => { sequence.push(position.ply); return { score: { kind: "cp", value: position.ply } }; },
    save: async (position, result) => { stored.set(String(position.ply), result); },
    complete: () => { completed++; },
  });
  assert.equal(count, 3);
  assert.deepEqual(sequence, [1, 2]);
  assert.equal(completed, 3);

  const resumeSequence = [];
  const resumed = await analyzePositionsSequentially({
    positions, signal: new AbortController().signal,
    load: async (position) => stored.get(String(position.ply)) ?? null,
    analyze: async (position) => { resumeSequence.push(position.ply); return { score: { kind: "cp", value: 0 } }; },
    save: async () => {}, complete: () => {},
  });
  assert.equal(resumed, 3);
  assert.deepEqual(resumeSequence, []);

  const cancel = new AbortController();
  const cancelSequence = [];
  await analyzePositionsSequentially({
    positions, signal: cancel.signal, load: async () => null,
    analyze: async (position) => { cancelSequence.push(position.ply); if (position.ply === 1) cancel.abort(); return { score: null }; },
    save: async () => {}, complete: () => {},
  });
  assert.deepEqual(cancelSequence, [0, 1]);
});
