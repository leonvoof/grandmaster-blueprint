"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cacheAnalysis, readAnalysis } from "@/lib/stockfish/cache";
import { DEFAULT_DEPTH, ENGINE_BUILD, ENGINE_SETTINGS, MAX_DEPTH, MIN_DEPTH, runStockfish } from "@/lib/stockfish/engine";
import type { Analysis } from "@/lib/stockfish/position";
import { analyzePositionsSequentially, type GamePosition } from "@/lib/full-game-analysis";
import { EvaluationReview } from "@/components/evaluation-review";
import { evaluationValue, type ReviewPoint } from "@/lib/evaluation-review";
import { findCriticalMoves } from "@/lib/evaluation-review";
import { MistakeReviewSession } from "@/components/mistake-review-session";
import { StockfishAnalysis } from "@/components/stockfish-analysis";
import { moverAtPosition, moveNumberAtPosition } from "@/lib/game-viewer-controls";
import { classifyGameMoves, summarizeClassifiedMoves, classifiedMoveCount, MIN_CLASSIFICATION_DEPTH, type MoveClassification, type ClassificationThresholds } from "@/lib/game-review-classification";

type Position = GamePosition;
import { readBrowserAnalyses, saveBrowserAnalysis, type SavedAnalysis as Saved } from "@/lib/browser-game-review";
type Props = { browserLocal?: boolean; gameId: string; positions: Position[]; selectedPly: number; thresholds: ClassificationThresholds; onThresholdsChange: (value: ClassificationThresholds) => void; onSelect: (ply: number) => void; onPositionAnalysis?: (analysis: Analysis | null, fen?: string) => void; onSelectedMoveClassification?: (classification: MoveClassification | null, analyzing: boolean) => void; onReviewModeChange?: (active: boolean) => void; openingName?: string; playerColor?: "white" | "black" | null };

function fromSaved(saved: Saved): Analysis {
  return { engine: saved.engine, depth: saved.depth, score: saved.scoreType && saved.scoreValue !== null ? { kind: saved.scoreType, value: saved.scoreValue } : null, bestMove: saved.bestMove, variation: JSON.parse(saved.variation), ...(saved.terminal && { terminal: saved.terminal as Analysis["terminal"] }) };
}

export function FullGameAnalysis({ browserLocal, gameId, positions, selectedPly, thresholds, onThresholdsChange, onSelect, onPositionAnalysis, onSelectedMoveClassification, onReviewModeChange, openingName, playerColor }: Props) {
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [results, setResults] = useState<Record<number, Analysis>>({});
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState<{ fen: string; depth: number; analysis: Analysis } | null>(null);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [panel, setPanel] = useState<"moves" | "summary" | "graph">("moves");
  const liveJob = useRef<AbortController | null>(null);
  const job = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const activeMoveRef = useRef<HTMLButtonElement | null>(null);
  const activeResults = saved.filter((result) => result.engine === ENGINE_BUILD && result.settings === ENGINE_SETTINGS && result.depth === depth);
  const selectedPosition = positions.find((position) => position.ply === selectedPly);
  const selectedSaved = selectedPosition ? byPositionResult(activeResults, selectedPosition) : undefined;
  const selectedAnalysis = useMemo(() => selectedPosition ? results[selectedPly] ?? (selectedSaved ? fromSaved(selectedSaved) : null) : null, [results, selectedPly, selectedPosition, selectedSaved]);

  const visibleAnalysis = selectedAnalysis ?? (live && live.fen === selectedPosition?.fen && live.depth === depth ? live.analysis : null);
  useEffect(() => { onPositionAnalysis?.(visibleAnalysis, selectedPosition?.fen); }, [onPositionAnalysis, visibleAnalysis, selectedPosition?.fen]);
  useEffect(() => {
    setLive(null);
    if (!browserLocal || !ready || !selectedPosition || selectedAnalysis || running || reviewOpen) return;
    const fen = selectedPosition.fen;
    const controller = new AbortController();
    liveJob.current = controller;
    const key = JSON.stringify([gameId, fen, ENGINE_BUILD, ENGINE_SETTINGS, depth]);
    const timer = window.setTimeout(async () => {
      try {
        const analysis = readAnalysis(key) ?? await runStockfish(fen, depth, controller.signal, () => {});
        if (!controller.signal.aborted) { cacheAnalysis(key, analysis); setLive({ fen, depth, analysis }); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Position analysis failed.");
      }
    }, 100);
    return () => { clearTimeout(timer); controller.abort(); if (liveJob.current === controller) liveJob.current = null; };
  }, [browserLocal, ready, selectedPosition, selectedAnalysis, running, reviewOpen, gameId, depth]);
  useEffect(() => { onReviewModeChange?.(reviewOpen); }, [onReviewModeChange, reviewOpen]);
  useEffect(() => { const button = activeMoveRef.current;
    const list = button?.closest('[aria-label="Game moves"]');
    if (button && list) {
      const bounds = button.getBoundingClientRect();
      const viewport = list.getBoundingClientRect();
      if (bounds.top < viewport.top) list.scrollTop += bounds.top - viewport.top;
      if (bounds.bottom > viewport.bottom) list.scrollTop += bounds.bottom - viewport.bottom;
    } }, [selectedPly, panel]);

  useEffect(() => {
    const generationRef = generation;
    const controller = new AbortController();
    generation.current++;
    job.current?.abort(); job.current = null; setRunning(false); setError(""); setCompleted(0); setResults({}); setSaved([]); setReady(false);
    void (browserLocal ? readBrowserAnalyses(gameId) : fetch(`/api/games/${encodeURIComponent(gameId)}/analyses`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Could not load saved game analysis."); return response.json(); }).then((data) => data.analyses as Saved[]))
      .then((analyses) => { if (!controller.signal.aborted) { setSaved(analyses); setReady(true); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load saved analysis."); });
    return () => { controller.abort(); generationRef.current++; job.current?.abort(); job.current = null; };
  }, [gameId, browserLocal]);

  async function analyzeGame() {
    if (job.current || !ready) return;
    liveJob.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    const currentJob = ++generation.current;
    setRunning(true); setError(""); setCompleted(0); setResults({});
    const compatible = saved.filter((item) => item.engine === ENGINE_BUILD && item.settings === ENGINE_SETTINGS && item.depth === depth);
    const byPosition = new Map(compatible.map((item) => [`${item.ply}:${item.fen}`, item]));
    try {
      const done = await analyzePositionsSequentially({
        positions, signal: controller.signal,
        load: async (position) => {
          const existing = byPosition.get(`${position.ply}:${position.fen}`);
          const cacheKey = JSON.stringify([gameId, position.fen, ENGINE_BUILD, ENGINE_SETTINGS, depth]);
          return existing ? fromSaved(existing) : readAnalysis(cacheKey);
        },
        analyze: (position) => runStockfish(position.fen, depth, controller.signal, () => {}),
        save: async (position, analysis) => {
          const cacheKey = JSON.stringify([gameId, position.fen, ENGINE_BUILD, ENGINE_SETTINGS, depth]);
          cacheAnalysis(cacheKey, analysis);
          if (browserLocal) {
            const record = await saveBrowserAnalysis(gameId, position.ply, position.fen, ENGINE_SETTINGS, analysis, depth);
            if (!controller.signal.aborted) setSaved((previous) => [...previous.filter((item) => item.id !== record.id), record]);
            return;
          }
          const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/analyses`, {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
            body: JSON.stringify({ fen: position.fen, ply: position.ply, engine: ENGINE_BUILD, settings: ENGINE_SETTINGS, depth, score: analysis.score, bestMove: analysis.bestMove, variation: analysis.variation, terminal: analysis.terminal }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Could not save position analysis.");
          setSaved((previous) => [...previous.filter((item) => item.id !== payload.analysis.id), payload.analysis]);
        },
        complete: (position, analysis) => {
          if (generation.current !== currentJob) return;
          setResults((previous) => ({ ...previous, [position.ply]: analysis }));
          setCompleted((count) => count + 1);
        },
      });
      if (!controller.signal.aborted && generation.current === currentJob && done < positions.length) setError("Analysis paused. Run again to resume from saved positions.");
    } catch (reason) {
      if (!controller.signal.aborted && generation.current === currentJob) setError(reason instanceof Error ? reason.message : "Game analysis failed.");
    } finally {
      if (job.current === controller) { job.current = null; setRunning(false); }
    }
  }

  function cancel() { job.current?.abort(); job.current = null; setRunning(false); setError(""); }
  const total = positions.length;
  const savedPositionKeys = new Set(activeResults.map((item) => `${item.ply}:${item.fen}`));
  const doneCount = Math.max(Object.keys(results).length, positions.filter((position) => savedPositionKeys.has(`${position.ply}:${position.fen}`)).length);
  const reviewPoints: ReviewPoint[] = positions.map((position) => {
    const record = byPositionResult(activeResults, position);
    const result = results[position.ply];
    // Live results carry the UCI name while saved records carry the pinned build ID.
    const analysis = result ? { ...result, engine: ENGINE_BUILD } : record ? fromSaved(record) : null;
    return { ...position, ...evaluationValue(analysis), analysis, analysisId: record?.id, settings: analysis ? ENGINE_SETTINGS : undefined };
  });
  const classifications = classifyGameMoves(reviewPoints, thresholds);
  const classificationByPly = new Map(classifications.map((move) => [move.ply, move]));
  const selectedMoveClassification = classificationByPly.get(selectedPly)?.classification ?? null;
  const selectedMoveAnalyzing = Boolean(!selectedMoveClassification && !reviewOpen && (running || (browserLocal && ready && selectedPly > 0 && !selectedAnalysis && !visibleAnalysis)));
  useEffect(() => { onSelectedMoveClassification?.(selectedMoveClassification, selectedMoveAnalyzing); }, [onSelectedMoveClassification, selectedMoveClassification, selectedMoveAnalyzing]);
  const reviewableMoves = findCriticalMoves(reviewPoints, thresholds, classifications).map((move) => ({
    ...move,
    engine: reviewPoints[move.ply - 1]?.analysis?.engine,
    depth: reviewPoints[move.ply - 1]?.analysis?.depth,
  }));
  const gameSummary = summarizeClassifiedMoves(classifications);
  const analyzedAtDepth = positions.filter((position) => activeResults.some((item) => item.ply === position.ply && item.fen === position.fen)).length;
  if (reviewOpen) return <MistakeReviewSession gameId={gameId} browserLocal={browserLocal} critical={reviewableMoves} onSelect={onSelect} onExit={() => setReviewOpen(false)} openingName={openingName} playerColor={playerColor} />;
  return <section className="flex min-h-0 max-h-[max(480px,calc(100dvh-160px))] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11131b] shadow-[0_18px_60px_rgba(0,0,0,0.18)]" aria-label="Full game analysis">
    <header className="border-b border-white/[0.07] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="knightforge-eyebrow text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a994f0]">Game analysis</p><h2 className="mt-1 text-lg font-medium">Stockfish review</h2></div>
      <label className="flex items-center gap-2 text-xs text-gray-400">Depth<select aria-label="Analysis depth" className="rounded-lg border border-white/15 bg-[#0b0d13] px-2 py-2 text-sm text-white" value={depth} disabled={running} onChange={(event) => { setDepth(Number(event.target.value)); setResults({}); }}>{Array.from({ length: MAX_DEPTH - MIN_DEPTH + 1 }, (_, index) => index + MIN_DEPTH).map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {running ? <button className="rounded-lg border border-white/15 px-3 py-2 text-sm" onClick={cancel}>Cancel game analysis</button> : <button className="knightforge-primary-action rounded-lg bg-[#7655dc]/25 px-3 py-2 text-sm" disabled={!total || !ready} onClick={analyzeGame}>Analyze Entire Game</button>}
      <span className="text-xs text-gray-400">{activeResults.length} saved at this depth</span>
    </div>
    <p className="mt-2 text-xs text-gray-400" role="status">{running ? `${completed} / ${total} positions completed` : doneCount ? `${doneCount} / ${total} positions loaded` : `${total} positions · analysis starts on request`}</p>
    {error && <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>}
    </header>
    {!reviewOpen && <div className="border-b border-white/[0.07] bg-[#0d0f16] px-4 py-3" aria-live="polite">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Selected position · White perspective</p><p className="mt-0.5 text-xl font-semibold tabular-nums text-white">{visibleAnalysis ? visibleAnalysis.score?.kind === "mate" ? `${visibleAnalysis.score.value > 0 ? "White" : visibleAnalysis.score.value < 0 ? "Black" : ""} ${visibleAnalysis.score.value === 0 ? "Mate" : `mates in ${Math.abs(visibleAnalysis.score.value)}`}` : visibleAnalysis.score ? `${visibleAnalysis.score.value > 0 ? "+" : ""}${(visibleAnalysis.score.value / 100).toFixed(2)}` : visibleAnalysis.terminal ?? "Evaluation unavailable" : browserLocal ? "Analyzing position…" : "No saved evaluation"}</p></div>
      {visibleAnalysis?.bestMove && <div className="text-right"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Best move</p><p className="knightforge-analysis-accent mt-0.5 font-mono text-lg text-[#c7b8ff]">{visibleAnalysis.bestMove}</p></div>}</div>
      {selectedPly > 0 && (() => {
        const move = classificationByPly.get(selectedPly);
        if (!move) return null;
        const lostPawns = move.lossCp === null ? null : Math.max(0, move.lossCp / 100);
        const explanation = move.classification === "Best" ? "This move matches the engine's top continuation."
          : move.classification === "Excellent" ? "The move keeps the position close to the engine's top choice."
          : move.classification === "Good" ? "The move keeps most of the position's evaluation."
          : move.classification === "Inaccuracy" ? "The move gives the opponent a better position."
          : move.classification === "Mistake" ? "The move lets the opponent gain a clear advantage."
          : move.classification === "Blunder" ? "The move allows a major improvement for the opponent."
          : move.classification ? "Classification is based on the saved engine analysis." : "There is not enough compatible engine evidence to assess this move.";
        return <div className={`mt-2 rounded-lg border border-white/[0.07] bg-black/15 p-2.5 text-xs ${move.classification ? classificationColor(move.classification) : "text-gray-400"}`}>
          <p><strong>{move.classification ? `${classificationIcon(move.classification)} ${move.classification}` : "Unassessed"}</strong> · {explanation}{lostPawns !== null && lostPawns > 0 ? ` Estimated loss: ${lostPawns.toFixed(2)} pawns.` : ""}</p>
          {move.bestMove && move.continuation.length > 0 && <p className="mt-1 text-gray-300">The engine recommends <strong>{move.bestMove}</strong>{move.continuation.length > 1 ? ` ${move.continuation.slice(1).join(" ")}` : ""} from the position before this move.</p>}
          <details className="mt-1 text-gray-400"><summary className="cursor-pointer">Details</summary><p className="mt-1">{move.reason}{move.lossCp !== null ? ` Exact estimated loss: ${move.lossCp} cp.` : ""}</p></details>
        </div>;
      })()}
      {visibleAnalysis?.variation.length ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-300"><span className="text-gray-500">Continuation</span> · {visibleAnalysis.variation.join(" ")}</p> : <p className="mt-1 text-xs text-gray-500">{visibleAnalysis ? `Depth ${visibleAnalysis.depth} · ${visibleAnalysis.engine}` : "Analyze this game to save evaluations and engine continuations."}</p>}
    </div>}
    {!reviewOpen && !browserLocal && <details className="border-b border-white/[0.07] px-4 py-2"><summary className="cursor-pointer text-xs font-medium text-gray-300">Analyze selected position with Stockfish</summary><StockfishAnalysis fen={selectedPosition?.fen ?? positions[0]?.fen ?? ""} gameId={gameId} /></details>}
    {!reviewOpen && <div className="flex items-center gap-1 border-b border-white/[0.07] px-3 pt-2" role="tablist" aria-label="Analysis views">
      <button role="tab" aria-selected={panel === "moves"} className={`knightforge-tab rounded-t-lg px-3 py-2 text-xs ${panel === "moves" ? "bg-[#7655dc]/20 text-white" : "text-gray-400 hover:text-white"}`} onClick={() => setPanel("moves")}>Moves</button>
      <button role="tab" aria-selected={panel === "summary"} className={`knightforge-tab rounded-t-lg px-3 py-2 text-xs ${panel === "summary" ? "bg-[#7655dc]/20 text-white" : "text-gray-400 hover:text-white"}`} onClick={() => setPanel("summary")}>Game review</button>
      <button role="tab" aria-selected={panel === "graph"} className={`knightforge-tab rounded-t-lg px-3 py-2 text-xs ${panel === "graph" ? "bg-[#7655dc]/20 text-white" : "text-gray-400 hover:text-white"}`} onClick={() => setPanel("graph")}>Graph & mistakes</button>
    </div>}
    {!reviewOpen && panel === "moves" && <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="Game moves">
      <button ref={selectedPly === 0 ? activeMoveRef : null} aria-current={selectedPly === 0 ? "step" : undefined} onClick={() => onSelect(0)} className={`knightforge-start-position mb-2 rounded-lg px-2.5 py-1.5 text-xs ${selectedPly === 0 ? "bg-[#7655dc] text-white" : "text-gray-400 hover:bg-white/5"}`}>Starting position</button>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-1">{positions.filter((position) => position.ply > 0).map((position) => {
      const analysis = results[position.ply] ?? (byPositionResult(activeResults, position) ? fromSaved(byPositionResult(activeResults, position)!) : null);
      const evaluation = analysis?.score ? analysis.score.kind === "mate" ? `M${analysis.score.value}` : (analysis.score.value / 100).toFixed(2) : analysis?.terminal ? "Draw" : "";
      const current = selectedPly === position.ply;
      const beforeFen = positions[position.ply - 1]?.fen;
      const critical = reviewableMoves.find((item) => item.ply === position.ply);
      const classification = classificationByPly.get(position.ply);
      return <button ref={current ? activeMoveRef : null} aria-current={current ? "step" : undefined} key={position.ply} className={`col-span-3 grid grid-cols-[2.5rem_minmax(0,1fr)_3rem] items-center rounded-lg border px-2.5 py-2 text-left text-sm transition-colors ${current ? "border-[#a58aff]/50 bg-[#7655dc]/20 text-white" : "border-transparent text-gray-300 hover:bg-white/[0.045]"}`} onClick={() => onSelect(position.ply)} title={`Go to ${critical ? `${critical.classification}: ` : ""}position ${position.ply}`}>
        <span className="text-[10px] tabular-nums text-gray-500">{moveNumberAtPosition(beforeFen, position.ply)}{moverAtPosition(beforeFen, position.ply) === "white" ? "." : "…"}</span><span className="truncate font-medium">{position.san}{classification?.classification && <span className={`ml-2 rounded px-1.5 py-0.5 text-[9px] ${classificationColor(classification.classification)} bg-white/[0.06]`} title={classification.reason}>{classificationIcon(classification.classification)} {classification.classification}</span>}</span><span className="knightforge-analysis-accent text-right font-mono text-[10px] text-[#c7b8ff]">{evaluation}</span>
      </button>;
    })}</div>
    </div>}
    {!reviewOpen && panel === "summary" && <div className="min-h-0 flex-1 overflow-y-auto p-4"><GameReviewSummary summary={gameSummary} onSelect={onSelect} onReviewMistakes={() => setReviewOpen(true)} analyzedAtDepth={analyzedAtDepth} totalPositions={total} running={running} /></div>}
    {!reviewOpen && panel === "graph" && <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"><EvaluationReview points={reviewPoints} selectedPly={selectedPly} onSelect={onSelect} thresholds={thresholds} onThresholdsChange={onThresholdsChange} critical={reviewableMoves} /></div>}
    <footer className="border-t border-white/[0.07] p-3"><button className="knightforge-primary-action w-full rounded-lg bg-[#7655dc]/20 px-3 py-2.5 text-sm font-medium hover:bg-[#7655dc]/30" onClick={() => setReviewOpen(true)}>Review My Mistakes</button></footer>
  </section>;
}

function byPositionResult(results: Saved[], position: Position) {
  return results.find((item) => item.ply === position.ply && item.fen === position.fen);
}

function classificationIcon(classification: MoveClassification) {
  return ({ Brilliant: "!!", Great: "!", Best: "★", Excellent: "✓", Good: "·", Inaccuracy: "?!", Mistake: "?", Blunder: "??", Book: "◇" })[classification];
}

function classificationColor(classification: MoveClassification) {
  return ({ Brilliant: "text-cyan-300", Great: "text-blue-300", Best: "text-green-300", Excellent: "text-lime-300", Good: "text-emerald-300", Inaccuracy: "text-yellow-300", Mistake: "text-orange-300", Blunder: "text-red-300", Book: "text-purple-300" })[classification];
}

function GameReviewSummary({ summary, onSelect, onReviewMistakes, analyzedAtDepth, totalPositions, running }: {
  summary: ReturnType<typeof summarizeClassifiedMoves>;
  onSelect: (ply: number) => void;
  onReviewMistakes: () => void;
  analyzedAtDepth: number;
  totalPositions: number;
  running: boolean;
}) {
  const labels: MoveClassification[] = ["Brilliant", "Great", "Best", "Excellent", "Good", "Inaccuracy", "Mistake", "Blunder", "Book"];
  const total = classifiedMoveCount(summary);
  const hasAnalysis = analyzedAtDepth > 0;
  const hasEligibleMoves = total > 0;
  const reason = hasAnalysis
    ? "No moves met the current classification requirements. Moves need compatible before and after evaluations, a legal saved continuation, and sufficient search depth. Mate-only positions are not classified."
    : "Run full-game analysis to create compatible evaluations for this game.";
  return <section aria-label="Game review summary">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Game Review</h3><p className="mt-1 max-w-xl text-xs text-gray-400">Classifications require compatible searches at depth {MIN_CLASSIFICATION_DEPTH} or higher. Penalties depend on how much the mover’s estimated expected score drops. Mate scores and insufficient evidence are left unclassified.</p></div>
      <button className="knightforge-primary-action rounded-lg bg-[#7655dc]/25 px-3 py-2 text-xs hover:bg-[#7655dc]/35" onClick={onReviewMistakes}>Review My Mistakes</button></div>
    {running && !hasAnalysis ? <p className="mt-4 rounded-xl border border-white/[0.07] bg-black/15 p-4 text-sm text-gray-300">Analyzing game positions… classifications will appear as compatible results are saved.</p>
      : !hasAnalysis ? <p className="mt-4 rounded-xl border border-dashed border-white/10 bg-black/10 p-4 text-sm text-gray-400">Analyze game to see move classifications.</p>
        : !hasEligibleMoves ? <p className="mt-4 rounded-xl border border-white/[0.07] bg-black/10 p-4 text-sm text-gray-400">{reason}</p>
          : <><div className="mt-4 grid gap-3 sm:grid-cols-2">{(["white", "black"] as const).map((color) => {
            const entries = labels.filter((label) => summary.byColor[color][label] > 0);
            return <div key={color} className="rounded-xl border border-white/[0.07] bg-black/15 p-3"><h4 className="font-medium">{color === "white" ? "White" : "Black"}</h4>
              {entries.length ? <div className="mt-2 flex flex-wrap gap-2">{entries.map((label) => <span key={label} className={`rounded-lg border border-white/[0.06] bg-white/[0.035] px-2.5 py-1.5 text-xs ${classificationColor(label)}`}><strong>{classificationIcon(label)} {label}</strong><span className="ml-2 tabular-nums text-white">{summary.byColor[color][label]}</span></span>)}</div> : <p className="mt-2 text-xs text-gray-500">No classified moves.</p>}
            </div>;
          })}</div>
          <details className="mt-3 rounded-xl border border-white/[0.07]"><summary className="cursor-pointer px-3 py-2 text-xs text-gray-400">Show zero-count categories</summary><div className="grid gap-3 p-3 sm:grid-cols-2">{(["white", "black"] as const).map((color) => <div key={color}><h4 className="text-xs font-medium text-gray-400">{color === "white" ? "White" : "Black"}</h4><div className="mt-2 flex flex-wrap gap-1.5">{labels.filter((label) => !summary.byColor[color][label]).map((label) => <span key={label} className={`rounded bg-white/[0.035] px-2 py-1 text-[10px] ${classificationColor(label)}`}>{label} 0</span>)}</div></div>)}</div></details>
          <div className="mt-3 grid gap-3 sm:grid-cols-3"><SummaryCount title="Classified moves" value={total} /><SummaryCount title="Critical positions" value={summary.critical.length} /><SummaryCount title="Missed opportunities" value={summary.missedOpportunities.length} /></div>
          <h4 className="mt-5 text-sm font-medium">Critical positions &amp; missed opportunities</h4>{summary.critical.length ? <div className="mt-2 space-y-1">{summary.critical.map((move) => <button key={move.ply} className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2 text-left text-sm hover:bg-white/[0.04]" onClick={() => onSelect(move.ply)}><span>{move.color === "white" ? "White" : "Black"} · {Math.ceil(move.ply / 2)}{move.color === "white" ? "." : "…"} {move.san} · <span className={classificationColor(move.classification!)}>{move.classification}</span></span><span className="text-xs text-gray-400">{move.lossCp} cp loss {move.bestMove ? `· best: ${move.bestMove}` : ""}</span></button>)}</div> : <p className="mt-2 text-xs text-gray-500">No classified critical positions in the compatible saved data.</p>}
          </>
    }
    <p className="mt-4 text-[10px] leading-4 text-gray-500">Brilliant/Great and Book require verified evidence that is not available in single-PV analysis. They remain unassigned. {analyzedAtDepth < totalPositions && hasAnalysis ? `${totalPositions - analyzedAtDepth} positions do not yet have compatible saved results at this depth.` : ""}</p>
  </section>;
}

function SummaryCount({ title, value }: { title: string; value: number }) {
  return <div className="rounded-xl border border-white/[0.07] bg-[#0d0f16] p-3"><p className="text-xs text-gray-500">{title}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>;
}
