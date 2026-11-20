import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { addRepertoireMove, repertoireRoot } from "../lib/public-repertoire.ts";
import { publicPracticeRoot } from "../lib/public-opening-practice.ts";
import { beginExercise, playOpponent, requestHint, revealAnswer, submitTrainingMove } from "../lib/opening-trainer.ts";

const move = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
function fixture() {
  let repertoire = { id: randomUUID(), name: "Fixture", color: "white", moves: [] };
  function add(parent, uci) {
    const result = addRepertoireMove(repertoire, parent, move(uci), randomUUID());
    repertoire = result.repertoire;
    return result.id;
  }
  const e4 = add(repertoireRoot, "e2e4");
  const e5 = add(e4, "e7e5");
  add(e5, "g1f3");
  add(e5, "f1c4");
  add(e4, "c7c5");
  return repertoire;
}

test("public practice follows saved branches and accepts either White continuation", () => {
  const repertoire = fixture();
  const original = JSON.stringify(repertoire);
  const initial = beginExercise(publicPracticeRoot(repertoire), "w");
  const after = submitTrainingMove(initial, move("e2e4")).state;
  assert.equal(after.status, "opponent");
  assert.deepEqual(after.moves, ["e4"]);
  assert.equal(submitTrainingMove(after, move("e7e5")).state, after);
  const e5 = playOpponent(after, () => 0);
  assert.deepEqual(e5.moves, ["e4", "e5"]);
  assert.equal(playOpponent(e5, () => 0), e5);
  for (const input of ["g1f3", "f1c4"]) {
    const result = submitTrainingMove(e5, move(input));
    assert.equal(result.accepted, true);
    assert.equal(result.state.status, "complete");
  }
  assert.deepEqual(playOpponent(after, () => 0.99).moves, ["e4", "c5"]);
  assert.equal(JSON.stringify(repertoire), original);
});

test("Black starts with a saved White opener and can retry or use help", () => {
  const root = publicPracticeRoot({ ...fixture(), color: "black" });
  const initial = beginExercise(root, "b");
  assert.equal(initial.status, "opponent");
  const blackTurn = playOpponent(initial, () => 0);
  assert.deepEqual(blackTurn.moves, ["e4"]);
  const wrong = submitTrainingMove(blackTurn, move("e7e6"));
  assert.equal(wrong.accepted, false);
  assert.equal(wrong.state.position, blackTurn.position);
  const hinted = requestHint(wrong.state);
  assert.match(hinted.hint, /pawn/);
  assert.equal(hinted.revealed, "");
  const revealed = revealAnswer(hinted);
  assert.equal(revealed.revealed, "e5");
  const result = submitTrainingMove(revealed, move("e7e5"));
  assert.equal(result.accepted, true);
  assert.equal(result.state.stats.firstCorrect, 0);
  assert.equal(result.state.revealed, "");
  assert.equal(playOpponent(result.state, () => 0).status, "complete");
  assert.equal(beginExercise(root, "b").stats.attempted, 0);
});
