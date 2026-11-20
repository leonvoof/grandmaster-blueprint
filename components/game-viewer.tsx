"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { FullGameAnalysis } from "@/components/full-game-analysis";
import { LichessSync } from "@/components/lichess-sync";
import { StockfishAnalysis } from "@/components/stockfish-analysis";
import { loadGameReplay } from "@/lib/game-replay";
import { addExplorationMove, classifyExplorationMove, createExplorationTree, explorationAnalysisIdentity, explorationAnalysisQueue, explorationArrowTarget, explorationPath, normalizeExplorationAnalysis, rememberExplorationPositions, selectExplorationNode, undoExplorationMove, type ExplorationNode, type ExplorationTree } from "@/lib/position-exploration";
import { analysisKey, cacheAnalysis, readAnalysis } from "@/lib/stockfish/cache";
import { DEFAULT_DEPTH, ENGINE_BUILD, ENGINE_SETTINGS, MAX_DEPTH, MIN_DEPTH, runStockfish } from "@/lib/stockfish/engine";
import { connectedPlayerColor, evaluationBarState, gameViewerPositionForKey, resolveBoardOrientation, shouldIgnoreGameViewerShortcut, whiteEvaluationFillEdge, type OrientationMode } from "@/lib/game-viewer-controls";
import { publicExplorationTarget, rememberPath, variationEdges } from "@/lib/public-exploration";
import { browserGameId, readBrowserAnalyses, readBrowserVariation, saveBrowserVariation, type SavedAnalysis } from "@/lib/browser-game-review";
import { validatedPgn, type PublicGame } from "@/lib/public-progress";
import type { Analysis } from "@/lib/stockfish/position";

type Ply = { san: string; fen: string; from: string; to: string; promotion: string | null };
type Saved = { id: string; white: string; black: string; date: string | null; result: string | null; opening: string | null; lichessSpeed: string | null; pgn: string };

const navigationButtons = [
  { key: "ArrowUp", label: "Go to first move", symbol: "⇤" },
  { key: "ArrowLeft", label: "Previous move", symbol: "←" },
  { key: "ArrowRight", label: "Next move", symbol: "→" },
  { key: "ArrowDown", label: "Go to last move", symbol: "⇥" },
];

function nodeAnalysisKey(rootFen: string, node: ExplorationNode, depth: number, gameId: string | null) {
  return explorationAnalysisIdentity(rootFen, node, depth, ENGINE_BUILD, ENGINE_SETTINGS, gameId);
}

function cacheSavedAnalysisRecords(gameId: string, records: SavedAnalysis[]) {
  for (const record of records) {
    if (record.engine !== ENGINE_BUILD || record.settings !== ENGINE_SETTINGS) continue;
    try {
      const analysis: Analysis = { engine: record.engine, depth: record.depth, score: record.scoreType && record.scoreValue !== null ? { kind: record.scoreType, value: record.scoreValue } : null, bestMove: record.bestMove, variation: JSON.parse(record.variation), ...(record.terminal && { terminal: record.terminal as Analysis["terminal"] }) };
      cacheAnalysis(analysisKey(gameId, record.fen, record.depth), analysis);
    } catch { /* Ignore a corrupt local record; the live worker can replace it. */ }
  }
}

function EvaluationBar({ analysis, orientation, loading = false }: { analysis: Analysis | null; orientation: "white" | "black"; loading?: boolean }) {
  const state = evaluationBarState(analysis?.score ?? null, analysis?.terminal);
  const fillEdge = whiteEvaluationFillEdge(orientation);
  const topSide = orientation === "white" ? "B" : "W";
  const bottomSide = orientation === "white" ? "W" : "B";
  return <aside className="flex min-h-0 w-8 shrink-0 self-stretch flex-col items-center gap-1" aria-label={`Evaluation bar, White perspective: ${loading ? "analyzing" : state.label}`}>
    <span className={`max-w-8 truncate text-[9px] font-semibold ${topSide === "W" ? "text-white" : "text-gray-500"}`} title={topSide === "W" ? "White" : "Black"}>{topSide}</span>
    <div className="relative min-h-0 w-5 flex-1 overflow-hidden rounded-full border border-white/15 bg-[#08090d] shadow-inner" aria-hidden="true">
      <div className="absolute inset-x-0 bg-[#eceaf1] transition-[height,top,bottom] duration-300" style={{ [fillEdge]: 0, height: `${state.whitePercent}%` }} />
      {!state.known && <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_45%,#a58aff55_50%,transparent_55%)]" />}
    </div>
    <span className={`max-w-8 truncate text-[9px] font-semibold ${bottomSide === "W" ? "text-white" : "text-gray-500"}`} title={bottomSide === "W" ? "White" : "Black"}>{bottomSide}</span>
    <span className="mt-1 w-8 text-center text-[9px] font-mono leading-tight text-[#d8d1ee]" title="White-perspective evaluation">{loading ? "…" : state.label}</span>
    <span className="sr-only">Scores are always from White&apos;s perspective.</span>
  </aside>;
}

export function GameViewer({ local }: { local?: {
  games: PublicGame[];
  imported: PublicGame | null;
  save: (pgn: string, name: string) => boolean;
  importPanel?: React.ReactNode;
  restoreVersion: number;
} } = {}) {
  const browserLocal = Boolean(local);
  const [loadedPgn, setLoadedPgn] = useState("");
  const [libraryUsername, setLibraryUsername] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<{ fen: string; square: Square } | null>(null);
  const [promotionChoice, setPromotionChoice] = useState<{ from: Square; to: Square; fen: string } | null>(null);
  const promotionDialog = useRef<HTMLDialogElement>(null);
  const exploredButton = useRef<HTMLButtonElement>(null);
  const preferredChildren = useRef<Record<string, string>>({});

  const [pgn, setPgn] = useState("");
  const [err, setErr] = useState("");
  const [moves, setMoves] = useState<Ply[]>([]);
  const [idx, setIdx] = useState(0);
  const [orientationMode, setOrientationMode] = useState<OrientationMode>("auto");
  const [lichessUsername, setLichessUsername] = useState<string | null>(null);
  const [fen, setFen] = useState("");
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saving, setSaving] = useState(false);
  const [analysisGameId, setAnalysisGameId] = useState<string | null>(null);
  const [initialFen, setInitialFen] = useState(() => new Chess().fen());
  const [positionAnalysis, setPositionAnalysis] = useState<{ fen: string; analysis: Analysis } | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"board" | "analysis">("board");
  const [reviewMode, setReviewMode] = useState(false);
  const [exploreMode, setExploreMode] = useState(browserLocal);
  const [showOriginalReview, setShowOriginalReview] = useState(false);
  const [exploration, setExploration] = useState<ExplorationTree | null>(() => browserLocal ? createExplorationTree(new Chess().fen(), 0) : null);
  const [exploreDepth, setExploreDepth] = useState(DEFAULT_DEPTH);
  const [exploreAnalyses, setExploreAnalyses] = useState<Record<string, Analysis>>({});
  const [savedGameAnalyses, setSavedGameAnalyses] = useState<SavedAnalysis[]>([]);
  const [exploreStatus, setExploreStatus] = useState("");
  const [exploreError, setExploreError] = useState("");
  const [exploreTargets, setExploreTargets] = useState<string[]>([]);
  const exploreResultRef = useRef<Record<string, Analysis>>({});
  const [savingVariation, setSavingVariation] = useState(false);
  const activeExploreJob = useRef<AbortController | null>(null);
  const exploredNode = exploreMode && exploration ? exploration.nodes[exploration.currentId] : null;
  const explorationRootFen = exploration ? exploration.nodes[exploration.rootId].fen : "";
  const shown = exploreMode && exploredNode ? exploredNode.fen : idx > 0 ? moves[idx - 1].fen : initialFen;
  const orientation = resolveBoardOrientation(orientationMode, browserLocal ? libraryUsername : lichessUsername, meta);
  const playerColor = connectedPlayerColor(browserLocal ? libraryUsername : lichessUsername, meta);
  const currentMove = exploreMode ? exploredNode?.from && exploredNode.to ? { from: exploredNode.from, to: exploredNode.to } : null : idx > 0 ? moves[idx - 1] : null;
  const analysisForNode = (node: ExplorationNode | null) => {
    if (!node) return null;
    const nodeKey = nodeAnalysisKey(explorationRootFen, node, exploreDepth, analysisGameId);
    const liveResult = exploreAnalyses[nodeKey];
    if (liveResult) return liveResult;
    const saved = savedGameAnalyses.find((record) => record.ply === node.ply && record.fen === node.fen && record.engine === ENGINE_BUILD && record.settings === ENGINE_SETTINGS && record.depth === exploreDepth);
    if (!saved) return null;
    try {
      return { engine: saved.engine, depth: saved.depth, score: saved.scoreType && saved.scoreValue !== null ? { kind: saved.scoreType, value: saved.scoreValue } : null, bestMove: saved.bestMove, variation: JSON.parse(saved.variation) as string[], ...(saved.terminal && { terminal: saved.terminal as Analysis["terminal"] }) } satisfies Analysis;
    } catch { return null; }
  };
  const exploreAnalysis = analysisForNode(exploredNode);
  const selectedParent = exploredNode?.parentId && exploration ? exploration.nodes[exploredNode.parentId] : null;
  const parentAnalysis = analysisForNode(selectedParent);
  const exploreClassification = exploredNode && selectedParent ? classifyExplorationMove(selectedParent, exploredNode, parentAnalysis, exploreAnalysis, { inaccuracy: 50, mistake: 100, blunder: 200 }, browserLocal ? 10 : MIN_DEPTH) : null;
  const visibleAnalysis = exploreMode ? exploreAnalysis : positionAnalysis?.fen === shown ? positionAnalysis.analysis : null;
  const gamePositions = useMemo(() => [{ fen: initialFen, ply: 0, san: null }, ...moves.map((move, index) => ({ fen: move.fen, ply: index + 1, san: move.san }))], [initialFen, moves]);
  const updatePositionAnalysis = useCallback((analysis: Analysis | null, fen?: string) => setPositionAnalysis(analysis && fen ? { fen, analysis } : null), []);
  const updateReviewMode = useCallback((active: boolean) => {
    setReviewMode(active);
    if (active) setMobilePanel("analysis");
  }, []);

  const refreshSaved = useCallback(() => {
    if (browserLocal) return;
    void fetch("/api/games").then(async (response) => {
      if (!response.ok) throw new Error("Could not load saved games.");
      setSaved((await response.json()).games);
    }).catch(() => setErr("Could not load saved games."));
  }, [browserLocal]);
  useEffect(() => { refreshSaved(); }, [refreshSaved]);
  useEffect(() => {
    if (browserLocal) return;
    let active = true;
    void fetch("/api/lichess").then((response) => response.ok ? response.json() : null).then((data) => {
      if (active) setLichessUsername(data?.settings?.username ?? null);
    }).catch(() => { if (active) setLichessUsername(null); });
    return () => { active = false; };
  }, [browserLocal]);

  useEffect(() => {
    if (!browserLocal || !analysisGameId) { setSavedGameAnalyses([]); return; }
    let active = true;
    void readBrowserAnalyses(analysisGameId).then((records) => { if (active) { cacheSavedAnalysisRecords(analysisGameId, records); setSavedGameAnalyses(records); } })
      .catch(() => { if (active) setSavedGameAnalyses([]); });
    return () => { active = false; };
  }, [browserLocal, analysisGameId]);

  const position = useCallback((ply: number) => setIdx(Math.max(0, Math.min(moves.length, ply))), [moves.length]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (reviewMode || promotionChoice || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || shouldIgnoreGameViewerShortcut(event.target)) return;
      if (exploreMode && exploration) {
        const target = browserLocal ? publicExplorationTarget(exploration, event.key, preferredChildren.current) : explorationArrowTarget(exploration, event.key);
        if (target) {
          event.preventDefault();
          if (target === exploration.currentId) return;
          const selected = exploration.nodes[target];
          if (browserLocal) rememberPath(exploration, target, preferredChildren.current);
          setExploreTargets((previous) => rememberExplorationPositions(previous, ...(selected.parentId ? [selected.parentId] : []), target));
          setExploreStatus("Analyzing selected position…");
          setExploration((tree) => tree ? selectExplorationNode(tree, target) : tree);
        }
        return;
      }
      if (browserLocal && !moves.length) return;
      const next = gameViewerPositionForKey(event.key, idx, moves.length);
      if (next === null) return;
      event.preventDefault();
      position(next);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [idx, moves.length, position, exploreMode, exploration, reviewMode, promotionChoice, browserLocal]);

  const exploredFen = exploreMode && exploration ? exploration.nodes[exploration.currentId].fen : null;
  useEffect(() => {
    if (!exploreMode || !exploration || !exploredNode || reviewMode) return;
    const tree = exploration;
    const currentId = tree.currentId;
    const controller = new AbortController();
    activeExploreJob.current?.abort();
    activeExploreJob.current = controller;
    setExploreError("");
    const relatedIds = [...(exploredNode.parentId ? [exploredNode.parentId] : []), ...exploreTargets];
    const orderedIds = explorationAnalysisQueue(tree, currentId, relatedIds);
    const publish = (nodeKey: string, cacheKey: string, analysis: Analysis) => {
      const compatible = normalizeExplorationAnalysis(analysis, ENGINE_BUILD);
      exploreResultRef.current = { ...exploreResultRef.current, [nodeKey]: compatible };
      setExploreAnalyses((previous) => ({ ...previous, [nodeKey]: compatible }));
      cacheAnalysis(cacheKey, compatible);
    };
    async function analyzeQueue() {
      try {
        for (const id of orderedIds) {
          if (controller.signal.aborted || activeExploreJob.current !== controller) return;
          const node = tree.nodes[id];
          const nodeKey = nodeAnalysisKey(explorationRootFen, node, exploreDepth, analysisGameId);
          const cacheKey = analysisKey(analysisGameId, node.fen, exploreDepth);
          let analysis = exploreResultRef.current[nodeKey] ?? readAnalysis(cacheKey);
          if (analysis) { publish(nodeKey, cacheKey, analysis); continue; }
          setExploreStatus(id === currentId ? `Analyzing current position · depth ${exploreDepth}…` : `Analyzing a related move position · depth ${exploreDepth}…`);
          analysis = await runStockfish(node.fen, exploreDepth, controller.signal, (progress) => {
            if (activeExploreJob.current === controller && progress.phase === "searching" && id === currentId) setExploreStatus(`Analyzing · depth ${progress.depth} / ${exploreDepth}`);
          });
          if (controller.signal.aborted || activeExploreJob.current !== controller) return;
          publish(nodeKey, cacheKey, analysis);
        }
        if (!controller.signal.aborted && activeExploreJob.current === controller) setExploreStatus("Position analysis complete.");
      } catch (error) {
        if (!controller.signal.aborted && activeExploreJob.current === controller) {
          setExploreError(error instanceof Error ? error.message : "Stockfish analysis failed.");
          setExploreStatus("");
        }
      } finally { if (activeExploreJob.current === controller) activeExploreJob.current = null; }
    }
    void analyzeQueue();
    return () => { controller.abort(); if (activeExploreJob.current === controller) activeExploreJob.current = null; };
  }, [exploreMode, exploredFen, exploredNode, exploration, explorationRootFen, exploreTargets, exploreDepth, analysisGameId, reviewMode, browserLocal]);

  useEffect(() => {
    if (browserLocal) return;
    const pending = sessionStorage.getItem("weakness-open");
    if (!pending) return;
    try {
      const { gameId, ply } = JSON.parse(pending);
      sessionStorage.removeItem("weakness-open");
      void fetch("/api/games").then((response) => response.json()).then((data) => {
        const found = data.games.find((candidate: Saved) => candidate.id === gameId);
        if (!found) return;
        const replay = loadGameReplay(found.pgn);
        setPgn(found.pgn); setAnalysisGameId(found.id); setMoves(replay.moves); setInitialFen(replay.initialFen);
        setIdx(Math.max(0, Math.min(replay.moves.length, ply))); setMeta(replay.headers);
      });
    } catch { /* Ignore stale evidence navigation. */ }
  }, [browserLocal]);

  const load = useCallback((text: string, savedGameId: string | null = null, username: string | null = null) => {
    try {
      if (browserLocal) validatedPgn(text);
      const replay = loadGameReplay(text);
      setLoadedPgn(text); setLibraryUsername(username); preferredChildren.current = {};
      setReviewMode(false);
      activeExploreJob.current?.abort(); setExploreMode(false); setShowOriginalReview(false); setExploration(null); setExploreTargets([]);
      exploreResultRef.current = {}; setExploreAnalyses({}); setSavedGameAnalyses([]);
      setPgn(text); setAnalysisGameId(savedGameId); setMoves(replay.moves); setInitialFen(replay.initialFen);
      setIdx(0); setMeta(replay.headers); setPositionAnalysis(null); setErr(""); setMobilePanel("board");
    } catch { setErr("Could not read this PGN. Check the notation and try again."); }
  }, [browserLocal]);
  const imported = local?.imported;
  useEffect(() => { if (imported) load(imported.pgn, null, imported.sourceUsername); }, [imported, load]);
  useEffect(() => {
    if (!browserLocal || !loadedPgn) return;
    let active = true;
    void browserGameId(loadedPgn).then((id) => { if (active) setAnalysisGameId(id); })
      .catch(() => { if (active) setErr("Browser game storage requires a secure context."); });
    return () => { active = false; };
  }, [browserLocal, loadedPgn]);
  const variationId = browserLocal ? (loadedPgn ? analysisGameId : `fen:${initialFen}`) : null;
  useEffect(() => {
    if (!variationId) return;
    let active = true;
    void readBrowserVariation(variationId).then((edges) => {
      if (!active || !edges.length) return;
      let tree = createExplorationTree(initialFen, 0, moves);
      for (const edge of edges) {
        const result = addExplorationMove(selectExplorationNode(tree, edge.parent), edge.from, edge.to, edge.promotion ?? "q");
        if (!result.created) throw new Error("Saved variation contains a duplicate move.");
        tree = result.tree;
      }
      const restored = selectExplorationNode(tree, tree.rootId);
      setExploration((current) => current && variationEdges(current).length ? current : selectExplorationNode(restored, current && restored.nodes[current.currentId] ? current.currentId : restored.rootId));
    }).catch((reason) => { if (active) setExploreError(reason instanceof Error ? reason.message : "Could not restore variations."); });
    return () => { active = false; };
  }, [variationId, initialFen, moves]);
  async function saveTree() {
    if (!exploration || !variationId) return;
    try {
      await saveBrowserVariation(variationId, variationEdges(exploration));
      setExploreStatus("Variation tree saved in this browser.");
    } catch (reason) { setExploreError(reason instanceof Error ? reason.message : "Could not save variation tree."); }
  }
  useEffect(() => {
    const dialog = promotionDialog.current;
    if (promotionChoice && dialog && !dialog.open) dialog.showModal();
  }, [promotionChoice]);
  useEffect(() => {
    const button = exploredButton.current;
    const list = button?.closest('[aria-label="Variation moves"]');
    if (button && list) {
      const bounds = button.getBoundingClientRect(), visible = list.getBoundingClientRect();
      if (bounds.top < visible.top) list.scrollTop += bounds.top - visible.top;
      if (bounds.bottom > visible.bottom) list.scrollTop += bounds.bottom - visible.bottom;
    }
  }, [exploredNode?.id, mobilePanel]);
  async function save() {
    if (local) {
      try {
        const chess = validatedPgn(pgn);
        if (local.save(pgn.trim(), (chess.getHeaders().Event || "Untitled PGN").slice(0, 100))) {
          if (pgn !== loadedPgn) load(pgn);
          setErr("");
        }
      } catch { setErr("Use one valid PGN with legal moves."); }
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pgn }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSaved(data.games); setErr("");
    } catch (reason) { setErr(reason instanceof Error ? reason.message : "Could not save game."); }
    finally { setSaving(false); }
  }
  function move(from: string, to: string, promotion = "q") {
    if ((exploreMode && exploration) || browserLocal) {
      try {
        const tree = exploration ?? createExplorationTree(initialFen, 0, moves);
        const base = exploreMode ? tree : selectExplorationNode(tree, String(idx));
        setExploreError(""); setExploreStatus("Analyzing current position…");
        if (browserLocal && variationEdges(base).length >= 600) throw new Error("This variation tree has reached 600 explored moves.");
        const result = addExplorationMove(base, from, to, promotion as "q" | "r" | "b" | "n");
        setExploreTargets((previous) => rememberExplorationPositions(previous, base.currentId, result.tree.currentId));
        rememberPath(result.tree, result.tree.currentId, preferredChildren.current);
        setExploration(result.tree);
        setExploreMode(true);
        return true;
      } catch (reason) { setExploreError(reason instanceof Error ? reason.message : "That move is not legal in this position."); }
      return false;
    }
    const chess = new Chess(shown);
    try {
      chess.move({ from, to, promotion: "q" });
      setAnalysisGameId(null); setInitialFen(chess.fen()); setMoves([]); setIdx(0); setMeta({}); setPositionAnalysis(null);
      return true;
    } catch { return false; }
  }
  function loadFen() {
    try {
      const chess = new Chess(fen);
      activeExploreJob.current?.abort(); setExploreMode(false); setExploration(null); setExploreTargets([]);
      exploreResultRef.current = {}; setExploreAnalyses({}); setSavedGameAnalyses([]);
      setLoadedPgn("");
      setAnalysisGameId(null); setInitialFen(chess.fen()); setMoves([]); setIdx(0); setMeta({}); setPositionAnalysis(null); setErr("");
      if (browserLocal) { preferredChildren.current = {}; setExploration(createExplorationTree(chess.fen(), 0)); setExploreMode(true); }
    } catch { setErr("Invalid FEN. Check all six position fields."); }
  }

  function startExploration() {
    try {
      activeExploreJob.current?.abort();
      const line = idx < moves.length ? moves.slice(idx).map((ply) => ({ san: ply.san, fen: ply.fen, from: ply.from, to: ply.to, promotion: ply.promotion })) : [];
      const tree = browserLocal ? selectExplorationNode(exploration ?? createExplorationTree(initialFen, 0, moves), String(idx)) : createExplorationTree(shown, idx, line);
      if (browserLocal && analysisGameId) void readBrowserAnalyses(analysisGameId).then((records) => { cacheSavedAnalysisRecords(analysisGameId, records); setSavedGameAnalyses(records); }).catch(() => {});
      setExploration(tree); setExploreTargets((targets) => rememberExplorationPositions(targets, tree.currentId)); setExploreError(""); setExploreStatus(""); setExploreMode(true); setPositionAnalysis(null);
    } catch (reason) { setErr(reason instanceof Error ? reason.message : "Could not start position exploration."); }
  }
  function returnToGame() {
    activeExploreJob.current?.abort(); setPositionAnalysis(null); setExploreMode(false); setShowOriginalReview(false); if (!browserLocal) setExploration(null); setExploreTargets([]); setExploreError(""); setExploreStatus("");
  }
  function selectExplore(id: string) {
    setExploreError(""); setExploreStatus("Analyzing selected position…");
    const selected = exploration?.nodes[id];
    if (selected && exploration) rememberPath(exploration, id, preferredChildren.current);
    if (selected) setExploreTargets((previous) => rememberExplorationPositions(previous, ...(selected.parentId ? [selected.parentId] : []), id));
    setExploration((tree) => tree ? selectExplorationNode(tree, id) : tree);
  }
  async function saveExploration() {
    if (!exploration) return;
    const root = exploration.nodes[exploration.rootId];
    const path = explorationPath(exploration).slice(1);
    if (!path.length) return;
    try {
      const chess = new Chess(root.fen);
      chess.header("Event", "KnightForge explored variation");
      chess.header("White", meta.White || "Analysis White"); chess.header("Black", meta.Black || "Analysis Black"); chess.header("Result", "*");
      if (root.fen !== new Chess().fen()) { chess.header("SetUp", "1"); chess.header("FEN", root.fen); }
      for (const node of path) chess.move({ from: node.from!, to: node.to!, promotion: node.promotion ?? "q" });
      if (local) {
        if (local.save(chess.pgn(), "KnightForge explored variation")) setExploreStatus("Variation saved in this browser.");
        return;
      }
      setSavingVariation(true);
      const response = await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pgn: chess.pgn() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the variation.");
      setSaved(data.games); setExploreStatus("Saved as a separate game. The original game was not changed.");
    } catch (reason) { setExploreError(reason instanceof Error ? reason.message : "Could not save the explored line."); }
    finally { setSavingVariation(false); }
  }
  const assessmentColor = exploreClassification?.classification ? classificationSquareColor(exploreClassification.classification) : null;
  const lastMoveStyles = currentMove ? {
    [currentMove.from]: { background: "linear-gradient(0deg, rgba(165,138,255,.34), rgba(165,138,255,.34))" },
    [currentMove.to]: { background: assessmentColor ? `linear-gradient(0deg, ${assessmentColor}66, ${assessmentColor}66)` : "linear-gradient(0deg, rgba(165,138,255,.52), rgba(165,138,255,.52))", boxShadow: assessmentColor ? `inset 0 0 0 3px ${assessmentColor}` : undefined },
  } : {};
  const selected = selectedSquare?.fen === shown ? selectedSquare.square : null;
  const squareStyles = selected ? { ...lastMoveStyles, [selected]: { backgroundColor: "#a58aff99" } } : lastMoveStyles;
  function publicMove(from: Square, to: Square) {
    const candidates = new Chess(shown).moves({ square: from, verbose: true }).filter((candidate) => candidate.to === to);
    setSelectedSquare(null);
    if (candidates.some((candidate) => candidate.promotion)) { setPromotionChoice({ from, to, fen: shown }); return false; }
    return candidates.length > 0 && move(from, to);
  }
  function clickSquare(square: Square) {
    const board = new Chess(shown);
    if (board.get(square)?.color === board.turn()) setSelectedSquare({ fen: shown, square });
    else if (selected) publicMove(selected, square);
  }
  const explorePath = exploration ? explorationPath(exploration) : [];
  const explorationMoveLabel = (node: ExplorationTree["nodes"][string]) => {
    if (!node.san || !exploration || !node.parentId) return "Starting position";
    const parent = exploration.nodes[node.parentId];
    const moveNumber = Number(parent.fen.split(/\s+/)[5]) || 1;
    return `${moveNumber}${new Chess(parent.fen).turn() === "b" ? "…" : "."} ${node.san}`;
  };
  const renderExploreBranch = (id: string, depth = 0): React.ReactNode => {
    if (!exploration) return null;
    const node = exploration.nodes[id];
    const indent = node.parentId && exploration.nodes[node.parentId].children.length > 1 ? 1 : 0;
    const parent = node.parentId ? exploration.nodes[node.parentId] : null;
    const assessment = parent ? classifyExplorationMove(parent, node, analysisForNode(parent), analysisForNode(node), { inaccuracy: 50, mistake: 100, blunder: 200 }, 10) : null;
    const hasPairedAnalysis = Boolean(parent && analysisForNode(parent) && analysisForNode(node));
    const annotation = assessment?.classification ? `${classificationSymbol(assessment.classification)} ${assessment.classification}` : node.source === "exploration" ? hasPairedAnalysis ? "Unassessed" : "Analyzing…" : null;
    return <div key={id} className={indent && depth < 18 ? "ml-3 border-l border-white/10 pl-2" : ""}>
      <button ref={node.id === exploration.currentId ? exploredButton : null} aria-current={node.id === exploration.currentId ? "step" : undefined} className={`my-0.5 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm ${node.id === exploration.currentId ? "bg-[#7655dc]/25 text-white" : "text-gray-300 hover:bg-white/5"}`} onClick={() => selectExplore(node.id)}>
        <span>{explorationMoveLabel(node)}</span>
        <span className="ml-2 flex shrink-0 items-center gap-2 text-[9px] uppercase tracking-wide text-gray-500">{annotation && <span className={assessment?.classification ? classificationTextColor(assessment.classification) : "text-gray-400"}>{annotation}</span>}{node.source === "game" ? "Game" : node.source === "exploration" ? "Explored" : "Root"}</span>
      </button>
      {node.children.map((childId) => renderExploreBranch(childId, depth + 1))}
    </div>;
  };

  const library = local && <label className="block text-sm font-medium">Local game library<select className="field mt-2 w-full" value="" onChange={(event) => {
    const game = local.games[Number(event.target.value)];
    if (game) load(game.pgn, null, game.sourceUsername);
  }}><option value="" disabled>Choose a saved PGN</option>{local.games.map((game, index) => <option key={index} value={index}>{game.name}{game.sourceUsername ? ` · @${game.sourceUsername}` : ""}</option>)}</select></label>;

  return <div className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-white/[0.07] bg-[#11131b] px-4 py-3 sm:px-5">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a994f0]">Game workspace</p><h2 className="mt-1 text-lg font-medium">{meta.White || "White"} <span className="text-gray-500">vs</span> {meta.Black || "Black"}</h2><p className="mt-1 text-xs text-gray-500">{[meta.Date, meta.Opening, meta.Result].filter((value) => value && !value.includes("?") && value !== "*").join(" · ") || loadedPgn ? "PGN replay" : "Load a PGN or choose a saved game"}</p></div>
      {!browserLocal && <details className="relative"><summary className="cursor-pointer list-none rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/5">Lichess sync</summary><div className="absolute right-0 z-20 mt-2 w-[min(90vw,400px)] rounded-xl border border-white/10 bg-[#11131b] p-3 shadow-xl"><LichessSync onSynced={refreshSaved} /></div></details>}
    </div>

    {local && !reviewMode && <details className="rounded-xl border border-white/10 bg-[#11131b]">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Open game library{local.importPanel ? " or import from Lichess" : ""} <span className="ml-2 text-xs text-gray-400">{local.games.length} saved</span></summary>
      <div className="border-t border-white/10 p-4">{library}{local.importPanel && <div className="mt-4">{local.importPanel}</div>}</div>
    </details>}

    {!browserLocal && <div className={`${reviewMode ? "hidden" : "flex"} gap-2 xl:hidden`} role="tablist" aria-label="Game workspace panels">
      <button role="tab" aria-selected={mobilePanel === "board"} className={`flex-1 rounded-lg px-3 py-2 text-sm ${mobilePanel === "board" ? "bg-[#7655dc]/30 text-white" : "bg-white/5 text-gray-400"}`} onClick={() => setMobilePanel("board")}>Board</button>
      <button role="tab" aria-selected={mobilePanel === "analysis"} className={`flex-1 rounded-lg px-3 py-2 text-sm ${mobilePanel === "analysis" ? "bg-[#7655dc]/30 text-white" : "bg-white/5 text-gray-400"}`} onClick={() => setMobilePanel("analysis")}>Analysis & moves</button>
    </div>}

    <div className={`grid items-start gap-3 ${reviewMode ? "xl:grid-cols-1" : "lg:grid-cols-[minmax(0,1.08fr)_minmax(350px,0.92fr)] 2xl:grid-cols-[minmax(0,1.12fr)_minmax(390px,0.88fr)]"}`}>
      <section className={`${reviewMode ? "hidden" : browserLocal ? "block" : `${mobilePanel === "board" ? "block" : "hidden"} xl:block`} min-w-0 rounded-2xl border border-white/[0.08] bg-[#11131b] p-3 shadow-[0_18px_60px_rgba(0,0,0,0.18)] sm:p-4`} aria-label="Game board">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a994f0]">{exploreMode ? "Explore Position" : "Game position"}</p><p className="mt-1 text-xs text-gray-400">{exploreMode ? "Explore legal continuations without changing the saved PGN." : "Play any legal move to start a variation."}</p></div>{exploreMode ? (moves.length > 0 && <button className="btn" onClick={returnToGame}>Return to PGN</button>) : <button className="btn border-[#a58aff]/30 text-[#d7cbff]" onClick={startExploration}>Explore Position</button>}</div>
        <div className={`flex items-stretch gap-2 ${browserLocal ? "mx-auto lg:max-w-[min(100%,max(320px,calc(100dvh-365px)))]" : ""}`}>
          <EvaluationBar analysis={visibleAnalysis} orientation={orientation} loading={exploreMode && !exploreAnalysis && !exploreError} />
          <div className="min-w-0 flex-1"><Chessboard position={shown} boardOrientation={orientation} onPieceDrop={(from, to) => browserLocal ? publicMove(from, to) : move(from, to)} onSquareClick={browserLocal ? clickSquare : undefined} onPromotionCheck={(from, to) => { if (browserLocal) return false; try { return new Chess(shown).moves({ square: from, verbose: true }).some((candidate) => candidate.to === to && candidate.promotion); } catch { return false; } }} onPromotionPieceSelect={(piece, from, to) => { if (from && to) move(from, to, piece?.[1]?.toLowerCase() ?? "q"); return true; }} animationDuration={160} customDarkSquareStyle={browserLocal ? { backgroundColor: "#635781" } : undefined} customLightSquareStyle={browserLocal ? { backgroundColor: "#d9d4e5" } : undefined} customSquareStyles={squareStyles} /></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {exploreMode && browserLocal && exploration ? <>{navigationButtons.map(({ key, label, symbol }) => { const target = publicExplorationTarget(exploration, key, preferredChildren.current); return <button className="btn" key={key} aria-label={label} disabled={!target || target === exploration.currentId} onClick={() => target && selectExplore(target)}>{symbol}</button>; })}<span className="text-xs text-gray-400">{explorePath.length - 1} plies</span></> : exploreMode ? <><button className="btn" onClick={() => setExploration((tree) => tree ? undoExplorationMove(tree) : tree)}>Undo move</button><span className="min-w-20 text-center text-xs tabular-nums text-gray-400">{Math.max(0, explorePath.length - 1)} explored plies</span><button className="btn" onClick={returnToGame}>Return to game</button></> : <><button aria-label="Go to first move" title="Beginning (↑)" className="btn" onClick={() => position(0)}>⇤</button><button aria-label="Previous move" title="Previous (←)" className="btn" disabled={idx === 0} onClick={() => position(idx - 1)}>←</button><span className="min-w-20 text-center text-xs tabular-nums text-gray-400">{idx} / {moves.length}</span><button aria-label="Next move" title="Next (→)" className="btn" disabled={idx === moves.length} onClick={() => position(idx + 1)}>→</button><button aria-label="Go to last move" title="End (↓)" className="btn" onClick={() => position(moves.length)}>⇥</button></>}
          <button className="btn ml-auto border-[#a58aff]/30 text-[#d7cbff]" onClick={() => setOrientationMode(orientation === "white" ? "black" : "white")}>Flip board</button>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">View<select aria-label="Board orientation" className="rounded-lg border border-white/10 bg-[#0b0d13] px-2 py-2 text-xs text-gray-200" value={orientationMode} onChange={(event) => setOrientationMode(event.target.value as OrientationMode)}><option value="auto">Auto</option><option value="white">White</option><option value="black">Black</option></select></label>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500"><span>{exploreMode && !browserLocal ? "← / → traverse line · ↑ / ↓ choose sibling branch" : "← / → move · ↑ / ↓ beginning / end"}</span><span>Eval: White&apos;s perspective · {orientation === "white" ? "White" : "Black"} at bottom</span></div>
        {exploreMode && exploredNode?.san && <p role="status" aria-live="polite" className={`mt-2 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2 text-sm ${exploreClassification?.classification ? classificationTextColor(exploreClassification.classification) : "text-gray-300"}`}>{exploreClassification?.classification ? `${classificationSymbol(exploreClassification.classification)} ${exploreClassification.classification} · ${exploreClassification.lossCp} cp estimated loss` : !parentAnalysis || !exploreAnalysis ? "Analyzing move…" : "Unassessed · compatible centipawn evidence is unavailable for this move."}</p>}
      </section>

      <section className={`${browserLocal || mobilePanel === "analysis" ? "block" : "hidden"} min-w-0 xl:block`} aria-label="Analysis and move list">
        {exploreMode && exploration && <div className="flex min-h-0 max-h-[max(380px,calc(100dvh-160px))] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11131b]">
          <header className="border-b border-white/[0.07] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a994f0]">Explore position</p><h2 className="mt-1 text-lg font-medium">Stockfish analysis</h2><p className="mt-1 text-xs text-gray-400">{exploreStatus || "Analysis starts automatically for the selected position."} {exploreAnalysis ? `· ${exploreAnalysis.engine} depth ${exploreAnalysis.depth}` : ""}</p>{exploreError && <p role="alert" className="mt-2 text-xs text-red-300">{exploreError}</p>}</header>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-label="Variation moves">
            <section className="rounded-xl border border-white/[0.07] bg-black/15 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Position evaluation</h3><span className="font-mono text-sm text-[#d7cbff]">{exploreAnalysis?.terminal ?? (exploreAnalysis?.score ? exploreAnalysis.score.kind === "cp" ? `${(exploreAnalysis.score.value / 100).toFixed(2)} · White` : `Mate ${exploreAnalysis.score.value} · White` : "Pending")}</span></div><p className="mt-1 text-[11px] text-gray-500">Scores are from White&apos;s perspective. The evaluation bar beside the board updates with this position.</p>{exploreAnalysis?.bestMove && <p className="mt-3 text-sm text-gray-200">Best move: <strong className="text-white">{exploreAnalysis.variation[0] ?? exploreAnalysis.bestMove}</strong></p>}{exploreAnalysis?.variation.length ? <p className="mt-1 text-xs leading-relaxed text-gray-400">Continuation: {exploreAnalysis.variation.join(" ")}</p> : null}</section>
            {selectedParent && exploredNode?.san && <section className="rounded-xl border border-white/[0.07] p-3"><h3 className="text-sm font-medium">Explored move assessment</h3>{exploreClassification ? <><p className="mt-2 text-sm text-[#d7cbff]">{exploreClassification.classification} · {exploreClassification.lossCp} cp loss from {exploreClassification.color === "white" ? "White" : "Black"}&apos;s perspective{parentAnalysis && parentAnalysis.depth < 10 ? " · provisional" : ""}</p><p className="mt-1 text-xs text-gray-400">{explorationMoveLabel(exploredNode)}. Before: {exploreClassification.evaluationBefore?.toFixed(2) ?? "—"}; after: {exploreClassification.evaluationAfter?.toFixed(2) ?? "—"}. Top saved alternative: {exploreClassification.bestMove ?? "unavailable"}. {exploreClassification.reason} This is an estimate, not a judgment of intent.</p></> : !parentAnalysis || !exploreAnalysis ? <p className="mt-2 text-xs text-gray-400">{exploreError ? `Unassessed: ${exploreError}` : "Analyzing move and adjacent positions…"}</p> : <p className="mt-2 text-xs text-gray-400">Unassessed: compatible centipawn evaluations and a legal principal variation are required. Mate scores remain separate and are not converted to centipawns.</p>}</section>}
            <section className="rounded-xl border border-white/[0.07] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Analysis controls</h3><label className="flex items-center gap-2 text-xs text-gray-400">Depth<select aria-label="Exploration analysis depth" className="rounded-lg border border-white/10 bg-[#0b0d13] px-2 py-1.5 text-xs text-gray-200" value={exploreDepth} onChange={(event) => { setExploreStatus("Analyzing current position…"); setExploreDepth(Number(event.target.value)); }}>{Array.from({ length: MAX_DEPTH - MIN_DEPTH + 1 }, (_, i) => MIN_DEPTH + i).map((depth) => <option key={depth} value={depth}>{depth}</option>)}</select></label></div><div className="mt-3 flex flex-wrap gap-2"><button className="btn" disabled={exploreDepth >= MAX_DEPTH} onClick={() => { setExploreStatus("Analyzing current position…"); setExploreDepth((depth) => Math.min(MAX_DEPTH, depth + 2)); }}>Analyze Deeper</button><button className="btn" disabled={savingVariation || explorePath.length < 2} onClick={() => void saveExploration()}>{savingVariation ? "Saving…" : "Save explored line as separate game"}</button>{browserLocal && <button className="btn" disabled={!variationId || !variationEdges(exploration).length} onClick={() => void saveTree()}>Save variation tree</button>}</div><p className="mt-2 text-[10px] text-gray-500">Positions are analyzed automatically. Results use the local browser cache and current engine/depth settings. Save a line as a separate PGN or save the complete variation tree to continue exploring later.</p></section>
            <section className="rounded-xl border border-white/[0.07] p-3"><h3 className="mb-2 text-sm font-medium">Variation tree</h3>{exploration.nodes[exploration.rootId].children.length ? renderExploreBranch(exploration.rootId) : <p className="text-xs text-gray-500">No moves explored yet.</p>}</section>
            {analysisGameId && <button className="btn self-start" onClick={() => setShowOriginalReview((visible) => !visible)}>{showOriginalReview ? "Hide original game review" : "Show original game review"}</button>}
          </div>
        </div>}
        {analysisGameId ? <div className={exploreMode && !showOriginalReview ? "hidden" : "block"}><FullGameAnalysis key={`${analysisGameId}:${local?.restoreVersion ?? 0}`} browserLocal={browserLocal} gameId={analysisGameId} positions={gamePositions} selectedPly={idx} onSelect={position} onPositionAnalysis={updatePositionAnalysis} onReviewModeChange={updateReviewMode} openingName={meta.Opening} playerColor={playerColor} /></div> : !exploreMode && <div className="flex min-h-0 max-h-[max(380px,calc(100dvh-160px))] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11131b]">
          <header className="border-b border-white/[0.07] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a994f0]">Position analysis</p><h2 className="mt-1 text-lg font-medium">Explore this game</h2><p className="mt-1 text-xs text-gray-400">{positionAnalysis ? `White perspective · ${positionAnalysis.analysis.engine} depth ${positionAnalysis.analysis.depth}` : "Load and save a game to see persistent evaluations and review tools."}</p></header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-[auto_1fr_1fr] gap-1" aria-label="Game moves">{moves.map((ply, index) => <button key={`${ply.from}-${ply.to}-${index}`} className={`col-span-3 grid grid-cols-[2.5rem_minmax(0,1fr)] rounded-lg px-2.5 py-2 text-left text-sm ${idx === index + 1 ? "bg-[#7655dc]/20 text-white" : "text-gray-300 hover:bg-white/5"}`} onClick={() => position(index + 1)}><span className="text-[10px] text-gray-500">{Math.ceil((index + 1) / 2)}{index % 2 ? "…" : "."}</span><span>{ply.san}</span></button>)}</div>
            {!moves.length && <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-gray-400">Load a PGN to navigate moves, or drag a piece to explore a legal move.</p>}
            <details className="mt-3 rounded-xl border border-white/[0.07] p-3"><summary className="cursor-pointer text-sm font-medium">Analyze selected position with Stockfish</summary><StockfishAnalysis fen={shown} gameId={analysisGameId} /></details>
          </div>
        </div>}
      </section>
    </div>

    {!reviewMode && <details className="rounded-2xl border border-white/[0.08] bg-[#11131b]">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-200">Paste or upload a PGN · FEN controls</summary>
      <div className="grid gap-4 border-t border-white/[0.07] p-4 lg:grid-cols-2">
        <div><h3 className="text-sm font-medium">Game information</h3><div className="mt-2 flex flex-wrap gap-1.5">{["White", "WhiteElo", "Black", "BlackElo", "Date", "Result", "Opening", "TimeControl"].filter((key) => meta[key]).map((key) => <span key={key} className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-gray-300">{key}: {meta[key]}</span>)}</div>
          <label className="mt-4 block text-xs text-gray-400">Choose PGN file<input className="field mt-2 block w-full" type="file" accept=".pgn,text/plain" onChange={async (event) => { const file = event.target.files?.[0]; if (file) load(await file.text()); }} /></label>
          <textarea aria-label="Paste PGN" className="field mt-3 h-24 w-full" value={pgn} onChange={(event) => setPgn(event.target.value)} placeholder="Paste PGN here…" />
          <div className="mt-2 flex flex-wrap gap-2"><button className="btn" onClick={() => load(pgn)}>Load PGN</button><button className="btn" disabled={saving || !pgn.trim()} onClick={save}>{saving ? "Saving…" : browserLocal ? "Save PGN in this browser" : "Save PGN games"}</button></div>
          <label className="mt-4 block text-xs text-gray-400">Load FEN position<input aria-label="Load FEN position" className="field mt-2 w-full" placeholder="Six-field FEN" value={fen} onChange={(event) => setFen(event.target.value)} /></label><div className="mt-2 flex gap-2"><button className="btn" onClick={loadFen}>Load FEN</button><button className="btn" onClick={() => void navigator.clipboard.writeText(shown)}>Copy current FEN</button></div>
          {err && <p role="alert" className="mt-3 text-sm text-red-300">{err}</p>}
        </div>
        {local ? null : <div><h3 className="text-sm font-medium">Saved games <span className="text-xs font-normal text-gray-500">{saved.length}</span></h3><div className="mt-2 max-h-72 space-y-1 overflow-y-auto">{saved.map((item) => <button key={item.id} className={`block w-full rounded-lg border p-2.5 text-left text-xs transition-colors ${analysisGameId === item.id ? "border-[#a58aff]/35 bg-[#7655dc]/10" : "border-transparent hover:bg-white/[0.05]"}`} onClick={() => load(item.pgn, item.id)}><span className="block font-medium text-gray-200">{item.white} — {item.black}</span><span className="mt-1 block text-gray-500">{item.date || "Date unknown"} · {item.opening || "Opening unknown"} · {item.result || "Result unknown"}{item.lichessSpeed ? ` · ${item.lichessSpeed}` : ""}</span></button>)}{!saved.length && <p className="rounded-lg bg-black/20 p-3 text-xs text-gray-500">No saved games yet.</p>}</div></div>}
      </div>
    </details>}
    {promotionChoice && <dialog ref={promotionDialog} aria-label="Choose promotion piece" className="m-auto rounded-xl border border-white/15 bg-[#171322] p-5 text-white backdrop:bg-black/50" onCancel={() => setPromotionChoice(null)}>
      <p className="mb-3 font-medium">Promote pawn</p>
      <div className="flex flex-wrap gap-2">{([["q", "Queen"], ["r", "Rook"], ["b", "Bishop"], ["n", "Knight"]] as const).map(([piece, label]) => <button key={piece} className="btn" onClick={() => { if (promotionChoice.fen === shown) move(promotionChoice.from, promotionChoice.to, piece); setPromotionChoice(null); }}>{label}</button>)}
      <button className="btn" onClick={() => setPromotionChoice(null)}>Cancel</button></div>
    </dialog>}
  </div>;
}

function classificationSymbol(classification: string) {
  return ({ Best: "★", Excellent: "✓", Good: "·", Inaccuracy: "?!", Mistake: "?", Blunder: "??" } as Record<string, string>)[classification] ?? "·";
}

function classificationTextColor(classification: string) {
  return ({ Best: "text-green-300", Excellent: "text-lime-300", Good: "text-emerald-300", Inaccuracy: "text-yellow-300", Mistake: "text-orange-300", Blunder: "text-red-300" } as Record<string, string>)[classification] ?? "text-gray-300";
}

function classificationSquareColor(classification: string) {
  return ({ Best: "#86efac", Excellent: "#bef264", Good: "#6ee7b7", Inaccuracy: "#fde047", Mistake: "#fb923c", Blunder: "#f87171" } as Record<string, string>)[classification] ?? null;
}
