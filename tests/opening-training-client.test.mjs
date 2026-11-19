import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier.startsWith("@/") ? nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context) : nextResolve(specifier, context);
} });
const { buildTrainingTree, playAnswer, requestHint, revealAnswer, startExercise } = await import("../lib/opening-trainer.ts");
const { makeReviewSavePayload, matchesReviewPosition, postOpeningReview } = await import("../lib/opening-training-client.ts");

test("review payload retains legal decision, assistance counters, color, and stable request key", () => {
  const exercise = startExercise(buildTrainingTree([{ pgn: "1. e4 e5 *" }]).roots[0], "w", () => 0);
  const wrong = playAnswer(exercise, { from: "d2", to: "d4" }, () => 0).state;
  const hinted = requestHint(wrong);
  const revealed = revealAnswer(hinted);
  const payload = makeReviewSavePayload({ repertoireId: "r1", chapterId: "c1", positionId: "p1", idempotencyKey: "session-occurrence-1", exercise: revealed, submittedMove: null });
  assert.deepEqual(payload, {
    repertoireId: "r1", chapterId: "c1", positionId: "p1", trainingColor: "w",
    idempotencyKey: "session-occurrence-1", submittedMove: null,
    incorrectAttempts: 1, hintsUsed: 1, answersRevealed: 1,
  });
});

test("position matching requires the same color, starting FEN, current FEN, and path context", () => {
  const current = { trainingColor: "b", startingFen: "start", fen: "current", contextPath: ["e4", "c5"] };
  assert.equal(matchesReviewPosition({ ...current, applicable: true }, current), true);
  assert.equal(matchesReviewPosition({ ...current, applicable: false }, current), false);
  assert.equal(matchesReviewPosition({ ...current, trainingColor: "w", applicable: true }, current), false);
  assert.equal(matchesReviewPosition({ ...current, contextPath: ["d4", "d5"], applicable: true }, current), false);
});

test("failed API saves surface an error and can be retried with the same idempotency key", async () => {
  const payload = {
    repertoireId: "r", chapterId: "c", positionId: "p", trainingColor: "w",
    idempotencyKey: "stable-review-key", submittedMove: "e2e4",
    incorrectAttempts: 0, hintsUsed: 0, answersRevealed: 0,
  };
  let calls = 0;
  const fetcher = async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(init.body).idempotencyKey, "stable-review-key");
    return calls === 1
      ? new Response(JSON.stringify({ error: "Temporary database failure." }), { status: 500 })
      : new Response(JSON.stringify({ duplicate: true }), { status: 200 });
  };
  await assert.rejects(postOpeningReview(payload, fetcher), /Temporary database failure/);
  assert.deepEqual(await postOpeningReview(payload, fetcher), { duplicate: true });
  assert.equal(calls, 2);
});
