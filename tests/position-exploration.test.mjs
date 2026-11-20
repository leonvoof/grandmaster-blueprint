import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
registerHooks({ resolve(specifier, context, nextResolve) { if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context); if (specifier === "./engine" && context.parentURL?.endsWith("/lib/stockfish/cache.ts")) return nextResolve(new URL("../lib/stockfish/engine.ts", import.meta.url).href, context); return nextResolve(specifier, context); } });
const { Chess } = await import("chess.js");
const { addExplorationMove, classifyExplorationMove, createExplorationTree, explorationAnalysisIdentity, explorationAnalysisQueue, explorationArrowTarget, explorationPath, normalizeExplorationAnalysis, rememberExplorationPositions, selectExplorationNode, undoExplorationMove } = await import("../lib/position-exploration.ts");
const { analysisKey } = await import("../lib/stockfish/cache.ts");
const thresholds = { inaccuracy: 50, mistake: 100, blunder: 200 };
const makeAnalysis = (value, variation, depth = 12, kind = "cp") => ({ engine: "Stockfish 19.0.1 Lite", depth, score: { kind, value }, bestMove: variation[0] ?? null, variation });

test("exploration seeds the real game line and branches without overwriting it", () => {
  const chess = new Chess();
  const e4 = chess.move("e4"); const e4Fen = chess.fen();
  const e5 = chess.move("e5"); const e5Fen = chess.fen();
  const tree = createExplorationTree(new Chess().fen(), 0, [{ san: e4.san, from: e4.from, to: e4.to, fen: e4Fen }, { san: e5.san, from: e5.from, to: e5.to, fen: e5Fen }]);
  const branched = addExplorationMove(tree, "d2", "d4").tree;
  assert.equal(branched.nodes["0"].children.length, 2);
  assert.equal(tree.nodes["0"].children.length, 1);
  assert.equal(branched.nodes[branched.currentId].san, "d4");
  assert.equal(explorationPath(branched).length, 2);
});

test("legal alternatives can be selected and traversed; illegal moves are rejected", () => {
  let tree = createExplorationTree(new Chess().fen(), 0);
  const e4 = addExplorationMove(tree, "e2", "e4"); tree = e4.tree;
  const e5 = addExplorationMove(tree, "e7", "e5"); tree = e5.tree;
  tree = undoExplorationMove(tree);
  const c5 = addExplorationMove(tree, "c7", "c5"); tree = c5.tree;
  assert.equal(explorationArrowTarget(tree, "ArrowUp"), e5.tree.currentId);
  tree = selectExplorationNode(tree, e5.tree.currentId);
  assert.equal(tree.nodes[tree.currentId].san, "e5");
  assert.throws(() => addExplorationMove(tree, "e7", "e5"));
});

test("each legal move queues current and adjacent positions automatically, with current position first", () => {
  let tree = createExplorationTree(new Chess().fen(), 0);
  const rootId = tree.currentId;
  tree = addExplorationMove(tree, "e2", "e4").tree;
  const e4Id = tree.currentId;
  let required = rememberExplorationPositions([], rootId, e4Id);
  assert.deepEqual(explorationAnalysisQueue(tree, e4Id, required), [e4Id, rootId]);
  tree = addExplorationMove(tree, "e7", "e5").tree;
  const e5Id = tree.currentId;
  required = rememberExplorationPositions(required, e4Id, e5Id, e5Id);
  assert.deepEqual(explorationAnalysisQueue(tree, e5Id, required), [e5Id, rootId, e4Id]);
  assert.equal(new Set(required).size, required.length);
});

test("branch changes prioritize that branch and keep transposed node assessments distinct", () => {
  let tree = createExplorationTree(new Chess().fen(), 0);
  for (const [from, to] of [["g1", "f3"], ["b8", "c6"], ["b1", "c3"], ["g8", "f6"]]) tree = addExplorationMove(tree, from, to).tree;
  const firstOrder = tree.currentId;
  tree = selectExplorationNode(tree, tree.rootId);
  for (const [from, to] of [["b1", "c3"], ["g8", "f6"], ["g1", "f3"], ["b8", "c6"]]) tree = addExplorationMove(tree, from, to).tree;
  const secondOrder = tree.currentId;
  assert.equal(tree.nodes[firstOrder].fen, tree.nodes[secondOrder].fen);
  assert.notEqual(explorationAnalysisIdentity(tree.nodes[tree.rootId].fen, tree.nodes[firstOrder], 12, "game"), explorationAnalysisIdentity(tree.nodes[tree.rootId].fen, tree.nodes[secondOrder], 12, "game"));
  assert.deepEqual(explorationAnalysisQueue(tree, secondOrder, [firstOrder, secondOrder]), [secondOrder, firstOrder]);
});

test("rapidly played move targets remain queued after switching branches", () => {
  let tree = createExplorationTree(new Chess().fen(), 0);
  const targets = [];
  const remember = (from, to) => {
    const parent = tree.currentId;
    tree = addExplorationMove(tree, from, to).tree;
    targets.splice(0, targets.length, ...rememberExplorationPositions(targets, parent, tree.currentId));
    return tree.currentId;
  };
  const e4 = remember("e2", "e4");
  const e5 = remember("e7", "e5");
  tree = selectExplorationNode(tree, tree.rootId);
  const d4 = remember("d2", "d4");
  const queue = explorationAnalysisQueue(tree, d4, targets);
  assert.equal(queue[0], d4, "selected variation is analyzed first");
  assert.ok([e4, e5, d4].every((id) => queue.includes(id)), "moves from the abandoned line remain scheduled");
  assert.equal(new Set(queue).size, queue.length, "revisited positions are analyzed once");
});

test("switching away from a move and back retains its node-keyed assessment", () => {
  let tree = createExplorationTree(new Chess().fen(), 0);
  const e4 = addExplorationMove(tree, "e2", "e4");
  tree = e4.tree;
  const d4 = addExplorationMove(selectExplorationNode(tree, tree.rootId), "d2", "d4");
  tree = d4.tree;
  const results = new Map();
  const cache = (node, analysis) => results.set(explorationAnalysisIdentity(tree.nodes[tree.rootId].fen, node, 12, "Stockfish", "single", "game"), analysis);
  cache(tree.nodes[e4.tree.currentId], makeAnalysis(0, ["e4"]));
  cache(tree.nodes[d4.tree.currentId], makeAnalysis(20, ["d4"]));
  const read = (node) => results.get(explorationAnalysisIdentity(tree.nodes[tree.rootId].fen, node, 12, "Stockfish", "single", "game"));
  tree = selectExplorationNode(tree, e4.tree.currentId);
  assert.equal(read(tree.nodes[tree.currentId]).score.value, 0);
  tree = selectExplorationNode(tree, d4.tree.currentId);
  assert.equal(read(tree.nodes[tree.currentId]).score.value, 20);
  tree = selectExplorationNode(tree, e4.tree.currentId);
  assert.equal(read(tree.nodes[tree.currentId]).score.value, 0);
});

test("compatible FEN analysis cache keys are reused only at matching engine settings and depth", () => {
  const fen = new Chess().fen();
  assert.equal(analysisKey("game", fen, 12), analysisKey("game", fen, 12));
  assert.notEqual(analysisKey("game", fen, 12), analysisKey("game", fen, 14));
  assert.notEqual(analysisKey("game", fen, 12), analysisKey(null, fen, 12));
});

test("custom FEN and underpromotion remain legal and correctly represented", () => {
  const fen = "7k/P7/8/8/8/8/8/7K w - - 0 1";
  let tree = createExplorationTree(fen, 0);
  tree = addExplorationMove(tree, "a7", "a8", "n").tree;
  assert.equal(tree.nodes[tree.currentId].san, "a8=N");
  assert.equal(tree.nodes[tree.currentId].promotion, "n");
});

test("move assessments use mover perspective and identify the pre-move PV recommendation", () => {
  const chess = new Chess();
  const root = { id: "r", parentId: null, ply: 0, fen: chess.fen(), san: null, from: null, to: null, promotion: null, source: "root", children: [] };
  const e4 = chess.move("e4");
  const afterWhite = { id: "w", parentId: "r", ply: 1, fen: chess.fen(), san: e4.san, from: e4.from, to: e4.to, promotion: null, source: "exploration", children: [] };
  const white = classifyExplorationMove(root, afterWhite, makeAnalysis(100, ["e4"]), makeAnalysis(100, []), thresholds);
  assert.equal(white.color, "white"); assert.equal(white.classification, "Best"); assert.equal(white.bestMove, "e4");
  const blackBefore = { ...afterWhite, ply: 1 };
  const blackChess = new Chess(afterWhite.fen); const c5 = blackChess.move("c5");
  const blackAfter = { ...afterWhite, id: "b", parentId: "w", ply: 2, fen: blackChess.fen(), san: c5.san, from: c5.from, to: c5.to };
  const black = classifyExplorationMove(blackBefore, blackAfter, makeAnalysis(100, ["e5"]), makeAnalysis(250, []), thresholds);
  assert.equal(black.color, "black"); assert.equal(black.lossCp, 150); assert.equal(black.classification, "Mistake");
});

test("live UCI engine names normalize to the pinned identity used by saved evaluations", () => {
  const chess = new Chess(); chess.move("e4"); chess.move("e5");
  const before = { id: "2", parentId: "1", ply: 2, fen: chess.fen(), san: "e5", from: "e7", to: "e5", promotion: null, source: "game", children: [] };
  const move = chess.move("Nf3");
  const after = { id: "x", parentId: "2", ply: 3, fen: chess.fen(), san: move.san, from: move.from, to: move.to, promotion: null, source: "exploration", children: [] };
  const pinned = makeAnalysis(28, ["Nf3", "Nc6"]);
  const live = normalizeExplorationAnalysis({ ...makeAnalysis(27, ["Nf6", "Nc3"]), engine: "Stockfish 19 Lite WASM" }, pinned.engine);
  const assessment = classifyExplorationMove(before, after, pinned, live, thresholds, 10);
  assert.equal(live.engine, pinned.engine);
  assert.equal(assessment.classification, "Best");
  assert.equal(assessment.lossCp, 1);
});

test("assessments with missing, incompatible, shallow, illegal-PV, or mate evidence are withheld", () => {
  const chess = new Chess(); const before = { id: "r", parentId: null, ply: 0, fen: chess.fen(), san: null, from: null, to: null, promotion: null, source: "root", children: [] };
  const move = chess.move("e4"); const after = { id: "n", parentId: "r", ply: 1, fen: chess.fen(), san: move.san, from: move.from, to: move.to, promotion: null, source: "exploration", children: [] };
  const deep = makeAnalysis(0, ["e4"]);
  assert.equal(classifyExplorationMove(before, after, null, deep, thresholds), null);
  assert.equal(classifyExplorationMove(before, after, deep, makeAnalysis(0, [], 10), thresholds), null);
  assert.equal(classifyExplorationMove(before, after, makeAnalysis(0, ["e4"], 5), makeAnalysis(0, [], 5), thresholds), null);
  assert.equal(classifyExplorationMove(before, after, makeAnalysis(0, ["Qh9"]), makeAnalysis(0, []), thresholds), null);
  assert.equal(classifyExplorationMove(before, after, makeAnalysis(0, ["e4"], 12, "mate"), makeAnalysis(0, [], 12, "mate"), thresholds), null);
});

test("live variation assessments use the same outcome-sensitive severity bands", () => {
  const tree = createExplorationTree(new Chess().fen(), 0);
  const branch = addExplorationMove(tree, "a2", "a3").tree;
  const before = branch.nodes[branch.rootId];
  const after = branch.nodes[branch.currentId];
  const assess = (a, b) => classifyExplorationMove(before, after, makeAnalysis(a, ["Nf3"]), makeAnalysis(b, []), thresholds);
  assert.equal(assess(800, 500).classification, "Good");
  assert.equal(assess(100, 70).classification, "Good");
  assert.equal(assess(0, -250).classification, "Blunder");
});
