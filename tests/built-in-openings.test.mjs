import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Chess } from "chess.js";
import { openingLibrary, openingLibraryPath, openingPreview } from "../lib/built-in-openings.ts";
import { beginExercise, playOpponent, submitTrainingMove } from "../lib/opening-trainer.ts";
import { publicPracticeRoot } from "../lib/public-opening-practice.ts";
import { decodeProgress, readProgress, saveProgress } from "../lib/public-progress.ts";
import { mergeRepertoireLines, repertoirePositions } from "../lib/public-repertoire.ts";
import { publicRequestAllowed } from "../lib/site-mode.ts";

const dataset = JSON.parse(readFileSync(new URL("../public/opening-library/lichess-cc0.json", import.meta.url)));
const library = openingLibrary(dataset);
const repertoire = (color) => ({ name: "Test repertoire", id: randomUUID(), color, moves: [] });

test("all source nodes replay legally from their parents and every named line is indexed", () => {
  const fens = [new Chess().fen()];
  for (let id = 1; id < dataset.nodes.length; id++) {
    const [parent, uci] = dataset.nodes[id];
    assert.ok(parent >= 0 && parent < id);
    const chess = new Chess(fens[parent]);
    chess.move(uci);
    fens.push(chess.fen());
  }
  assert.equal(new Set(library.entries.map(({ eco }) => eco)).size, 500);
  for (const entry of library.entries) {
    assert.ok(library.recognize(library.line(entry)).includes(entry));
  }
});

test("names and combined ECO searches are discoverable and previews identify exact recorded sequences", () => {
  for (const name of ["Italian Game", "Ponziani Opening", "Caro-Kann Defense", "Sicilian Defense", "Queen's Gambit"]) {
    assert.ok(library.search(name).some(({ family }) => family === name));
  }
  const [ponziani] = library.search("c44 ponziani");
  assert.equal(ponziani.name, "Ponziani Opening");
  assert.ok(library.search("C44").every(({ eco }) => eco === "C44"));
  assert.equal(openingPreview(library, ponziani).at(-1).san, "c3");
  assert.deepEqual(library.recognize(["h2h3", "h7h6", "a2a3", "a7a6"]), []);
  assert.equal(publicRequestAllowed(openingLibraryPath, "GET"), true);
  assert.equal(publicRequestAllowed(openingLibraryPath, "POST"), false);
  assert.equal(publicRequestAllowed("/opening-library/private.json", "GET"), false);
});

test("import merges branches, preserves custom nodes and IDs, and survives backup into a fresh browser", () => {
  const lines = library.families.get("Ponziani Opening").map(library.line);
  const original = mergeRepertoireLines(repertoire("white"), [["e2e4", "e7e5", "h2h3"]], randomUUID);
  const merged = mergeRepertoireLines(original, lines, randomUUID);
  assert.deepEqual(merged.moves.slice(0, original.moves.length), original.moves);
  assert.ok([...repertoirePositions(merged.moves).values()].some(({ children }) => children.length > 1));
  assert.deepEqual(mergeRepertoireLines(merged, lines, randomUUID), merged);
  assert.throws(() => mergeRepertoireLines(original, [["e2e5"]], randomUUID));
  const database = new Map();
  const storage = { getItem: (key) => database.get(key) ?? null, setItem: (key, value) => database.set(key, value) };
  const restored = decodeProgress(JSON.stringify({ version: 1, games: [], solves: { example: 2 }, recalls: 1, repertoires: [merged] }));
  saveProgress(storage, restored);
  assert.deepEqual(readProgress(storage).repertoires, [merged]);
  assert.deepEqual(readProgress(storage).solves, { example: 2 });
});

test("imported White and Black repertoires work directly with practice", () => {
  const line = library.line(library.search("B10 Caro-Kann Defense")[0]);
  for (const color of ["white", "black"]) {
    const saved = mergeRepertoireLines(repertoire(color), [line], randomUUID);
    const root = publicPracticeRoot(saved);
    let session = beginExercise(root, color === "white" ? "w" : "b");
    session = playOpponent(session, () => 0);
    assert.equal(session.status, "player");
    const uci = line[color === "white" ? 0 : 1];
    assert.equal(submitTrainingMove(session, { from: uci.slice(0, 2), to: uci.slice(2) }).accepted, true);
  }
});
