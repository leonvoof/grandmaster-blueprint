import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { addRepertoireMove, repertoirePositions, repertoireRoot } from "../lib/public-repertoire.ts";
import { decodeProgress, readProgress, saveProgress } from "../lib/public-progress.ts";

function add(repertoire, parent, from, to) {
  return addRepertoireMove(repertoire, parent, { from, to }, randomUUID());
}

const backup = { version: 1, games: [{ name: "Fixture", kind: "game", pgn: "1. e4 *" }], solves: { fixture: 2 }, recalls: 1 };
const emptyRepertoire = () => ({ id: randomUUID(), name: "Ponziani", color: "white", moves: [] });

test("saved branches keep connected legal positions and stable IDs without duplicate continuations", () => {
  const e4 = add(emptyRepertoire(), repertoireRoot, "e2", "e4");
  const e5 = add(e4.repertoire, e4.id, "e7", "e5");
  const nf3 = add(e5.repertoire, e5.id, "g1", "f3");
  const c5 = add(nf3.repertoire, e4.id, "c7", "c5");
  const positions = repertoirePositions(c5.repertoire.moves);
  assert.deepEqual(positions.get(e4.id).children, [e5.id, c5.id]);
  assert.equal(positions.get(nf3.id).san, "Nf3");
  assert.match(positions.get(c5.id).fen, /2p5/);
  assert.equal(add(c5.repertoire, e4.id, "e7", "e5").id, e5.id);
  assert.throws(() => add(c5.repertoire, c5.id, "a7", "a6"));
});

test("local reload and JSON restore preserve repertoires and existing progress", () => {
  const e4 = add(emptyRepertoire(), repertoireRoot, "e2", "e4");
  const legacy = decodeProgress(JSON.stringify(backup));
  assert.deepEqual(legacy.repertoires, []);
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_, json) => { raw = json; } };
  const saved = saveProgress(storage, { ...legacy, repertoires: [e4.repertoire] });
  assert.deepEqual(readProgress(storage), saved);
  assert.deepEqual(decodeProgress(JSON.stringify(saved)), { ...legacy, repertoires: [e4.repertoire] });
  const move = e4.repertoire.moves[0];
  for (const badMove of [{ ...move, parent: randomUUID() }, { ...move, to: "e5" }]) {
    assert.throws(() => saveProgress(storage, { ...saved, repertoires: [{ ...e4.repertoire, moves: [badMove] }] }));
  }
  assert.deepEqual(readProgress(storage), saved);
});
