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
import { classifyGameMoves, summarizeClassifiedMoves, type MoveClassification } from "@/lib/game-review-classification";

type Position = GamePosition;
type Saved = { id: string; gameId: string; fen: string; ply: number; engine: string; settings: string; depth: number; scoreType: "cp" | "mate" | null; scoreValue: number | null; bestMove: string | null; variation: string; terminal: string | null };
type Props = { gameId: string; positions: Position[]; selectedPly: number; onSelect: (ply: number) => void; onPositionAnalysis?: (analysis: Analysis | null) => void; onReviewModeChange?: (active: boolean) => void; openingName?: string; playerColor?: "white" | "black" | null };

function fromSaved(saved: Saved): Analysis {
  return { engine: saved.engine, depth: saved.depth, score: saved.scoreType && saved.scoreValue !== null ? { kind: saved.scoreType, value: saved.scoreValue } : null, bestMove: saved.bestMove, variation: JSON.parse(saved.variation), ...(saved.terminal && { terminal: saved.terminal as Analysis["terminal"] }) };
}

export function FullGameAnalysis({ gameId, positions, selectedPly, onSelect, onPositionAnalysis, onReviewModeChange, openingName, playerColor }: Props) {
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [results, setResults] = useState<Record<number, Analysis>>({});
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [panel, setPanel] = useState<"moves" | "summary" | "graph">("moves");
  const [thresholds, setThresholds] = useState({ inaccuracy: 50, mistake: 100, blunder: 200 });
  const job = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const activeMoveRef = useRef<HTMLButtonElement | null>(null);
  const activeResults = saved.filter((result) => result.engine === ENGINE_BUILD && result.settings === ENGINE_SETTINGS && result.depth === depth);
  const selectedPosition = positions.find((position) => position.ply === selectedPly);
  const selectedSaved = selectedPosition ? byPositionResult(activeResults, selectedPosition) : undefined;
  const selectedAnalysis = useMemo(() => selectedPosition ? results[selectedPly] ?? (selectedSaved ? fromSaved(selectedSaved) : null) : null, [results, selectedPly, selectedPosition, selectedSaved]);

  useEffect(() => { onPositionAnalysis?.(selectedAnalysis); }, [onPositionAnalysis, selectedAnalysis]);
  useEffect(() => { onReviewModeChange?.(reviewOpen); }, [onReviewModeChange, reviewOpen]);
  useEffect(() => { activeMoveRef.current?.scrollIntoView({ block: "nearest" }); }, [selectedPly, panel]);

  useEffect(() => {
    const generationRef = generation;
    const controller = new AbortController();
    generation.current++;
    job.current?.abort(); job.current = null; setRunning(false); setError(""); setCompleted(0); setResults({}); setSaved([]);
    void fetch(`/api/games/${encodeURIComponent(gameId)}/analyses`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Could not load saved game analysis."); return response.json(); })
      .then((data) => { if (!controller.signal.aborted) setSaved(data.analyses); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load saved analysis."); });
    return () => { controller.abort(); generationRef.current++; job.current?.abort(); job.current = null; };
  }, [gameId]);

  async function analyzeGame() {
    if (job.current) return;
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
  const doneCount = Object.keys(results).length;
  const reviewPoints: ReviewPoint[] = positions.map((position) => {
    const record = byPositionResult(activeResults, position);
    const analysis = results[position.ply] ?? (record ? fromSaved(record) : null);
    const savedPosition = byPositionResult(activeResults, position);
    return { ...position, ...evaluationValue(analysis), analysis, analysisId: savedPosition?.id, settings: savedPosition?.settings, fen: position.fen };
  });
  const reviewableMoves = findCriticalMoves(reviewPoints, thresholds).map((move) => ({
    ...move,
    san: positions[move.ply]?.san ?? move.san,
    engine: reviewPoints[move.ply - 1]?.analysis?.engine,
    depth: reviewPoints[move.ply - 1]?.analysis?.depth,
  }));
  const classifications = classifyGameMoves(reviewPoints, thresholds);
  const gameSummary = summarizeClassifiedMoves(classifications);
  const classificationByPly = new Map(classifications.map((move) => [move.ply, move]));
  if (reviewOpen) return <MistakeReviewSession gameId={gameId} critical={reviewableMoves} onSelect={onSelect} onExit={() => setReviewOpen(false)} openingName={openingName} playerColor={playerColor} />;
  return <section className="flex min-h-[min(70vh,720px)] max-h-[calc(100dvh-150px)] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11131b] shadow-[0_18px_60px_rgba(0,0,0,0.18)]" aria-label="Full game analysis">
    <header className="border-b border-white/[0.07] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a994f0]">Game analysis</p><h2 className="mt-1 text-lg font-medium">Stockfish review</h2></div>
      <label className="flex items-center gap-2 text-xs text-gray-400">Depth<select aria-label="Analysis depth" className="rounded-lg border border-white/15 bg-[#0b0d13] px-2 py-2 text-sm text-white" value={depth} disabled={running} onChange={(event) => { setDepth(Number(event.target.value)); setResults({}); }}>{Array.from({ length: MAX_DEPTH - MIN_DEPTH + 1 }, (_, index) => index + MIN_DEPTH).map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {running ? <button className="rounded-lg border border-white/15 px-3 py-2 text-sm" onClick={cancel}>Cancel game analysis</button> : <button className="rounded-lg bg-[#7655dc]/25 px-3 py-2 text-sm" disabled={!total} onClick={analyzeGame}>Analyze Entire Game</button>}
      <span className="text-xs text-gray-400">{activeResults.length} saved at this depth</span>
    </div>
    <p className="mt-2 text-xs text-gray-400" role="status">{running ? `${completed} / ${total} positions completed` : doneCount ? `${doneCount} / ${total} positions loaded` : `${total} positions · analysis starts on request`}</p>
    {error && <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>}
    </header>
    {!reviewOpen && <div className="border-b border-white/[0.07] bg-[#0d0f16] px-4 py-3" aria-live="polite">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Selected position · White perspective</p><p className="mt-0.5 text-xl font-semibold tabular-nums text-white">{selectedAnalysis ? selectedAnalysis.score?.kind === "mate" ? `${selectedAnalysis.score.value > 0 ? "White" : selectedAnalysis.score.value < 0 ? "Black" : ""} ${selectedAnalysis.score.value === 0 ? "Mate" : `mates in ${Math.abs(selectedAnalysis.score.value)}`}` : selectedAnalysis.score ? `${selectedAnalysis.score.value > 0 ? "+" : ""}${(selectedAnalysis.score.value / 100).toFixed(2)}` : selectedAnalysis.terminal ?? "Evaluation unavailable" : "No saved evaluation"}</p></div>
      {selectedAnalysis?.bestMove && <div className="text-right"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Best move</p><p className="mt-0.5 font-mono text-lg text-[#c7b8ff]">{selectedAnalysis.bestMove}</p></div>}</div>
      {classificationByPly.get(selectedPly)?.classification ? <p className={`mt-2 text-xs ${classificationColor(classificationByPly.get(selectedPly)!.classification!)}`}><strong>{classificationIcon(classificationByPly.get(selectedPly)!.classification!)} {classificationByPly.get(selectedPly)!.classification}</strong> · {classificationByPly.get(selectedPly)!.reason}</p> : selectedPly > 0 && <p className="mt-2 text-xs text-gray-500">{classificationByPly.get(selectedPly)?.reason ?? "No compatible classification evidence for this move."}</p>}
      {selectedAnalysis?.variation.length ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-300"><span className="text-gray-500">Continuation</span> · {selectedAnalysis.variation.join(" ")}</p> : <p className="mt-1 text-xs text-gray-500">{selectedAnalysis ? `Depth ${selectedAnalysis.depth} · ${selectedAnalysis.engine}` : "Analyze this game to save evaluations and engine continuations."}</p>}
    </div>}
    {!reviewOpen && <details className="border-b border-white/[0.07] px-4 py-2"><summary className="cursor-pointer text-xs font-medium text-gray-300">Analyze selected position with Stockfish</summary><StockfishAnalysis fen={selectedPosition?.fen ?? positions[0]?.fen ?? ""} gameId={gameId} /></details>}
    {!reviewOpen && <div className="flex items-center gap-1 border-b border-white/[0.07] px-3 pt-2" role="tablist" aria-label="Analysis views">
      <button role="tab" aria-selected={panel === "moves"} className={`rounded-t-lg px-3 py-2 text-xs ${panel === "moves" ? "bg-[#7655dc]/20 text-white" : "text-gray-400 hover:text-white"}`} onClick={() => setPanel("moves")}>Moves</button>
      <button role="tab" aria-selected={panel === "summary"} className={`rounded-t-lg px-3 py-2 text-xs ${panel === "summary" ? "bg-[#7655dc]/20 text-white" : "text-gray-400 hover:text-white"}`} onClick={() => setPanel("summary")}>Game review</button>
      <button role="tab" aria-selected={panel === "graph"} className={`rounded-t-lg px-3 py-2 text-xs ${panel === "graph" ? "bg-[#7655dc]/20 text-white" : "text-gray-400 hover:text-white"}`} onClick={() => setPanel("graph")}>Graph & mistakes</button>
    </div>}
    {!reviewOpen && panel === "moves" && <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="Game moves">
      <button ref={selectedPly === 0 ? activeMoveRef : null} onClick={() => onSelect(0)} className={`mb-2 rounded-lg px-2.5 py-1.5 text-xs ${selectedPly === 0 ? "bg-[#7655dc] text-white" : "text-gray-400 hover:bg-white/5"}`}>Starting position</button>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-1">{positions.filter((position) => position.ply > 0).map((position) => {
      const analysis = results[position.ply] ?? (byPositionResult(activeResults, position) ? fromSaved(byPositionResult(activeResults, position)!) : null);
      const evaluation = analysis?.score ? analysis.score.kind === "mate" ? `M${analysis.score.value}` : (analysis.score.value / 100).toFixed(2) : analysis?.terminal ? "Draw" : "";
      const current = selectedPly === position.ply;
      const critical = reviewableMoves.find((item) => item.ply === position.ply);
      const classification = classificationByPly.get(position.ply);
      return <button ref={current ? activeMoveRef : null} key={position.ply} className={`col-span-3 grid grid-cols-[2.5rem_minmax(0,1fr)_3rem] items-center rounded-lg border px-2.5 py-2 text-left text-sm transition-colors ${current ? "border-[#a58aff]/50 bg-[#7655dc]/20 text-white" : "border-transparent text-gray-300 hover:bg-white/[0.045]"}`} onClick={() => onSelect(position.ply)} title={`Go to ${critical ? `${critical.classification}: ` : ""}position ${position.ply}`}>
        <span className="text-[10px] tabular-nums text-gray-500">{Math.ceil(position.ply / 2)}{position.ply % 2 ? "." : "…"}</span><span className="truncate font-medium">{position.san}{classification?.classification && <span className={`ml-2 rounded px-1.5 py-0.5 text-[9px] ${classificationColor(classification.classification)} bg-white/[0.06]`} title={classification.reason}>{classificationIcon(classification.classification)} {classification.classification}</span>}</span><span className="text-right font-mono text-[10px] text-[#c7b8ff]">{evaluation}</span>
      </button>;
    })}</div>
    </div>}
    {!reviewOpen && panel === "summary" && <div className="min-h-0 flex-1 overflow-y-auto p-4"><GameReviewSummary summary={gameSummary} onSelect={onSelect} onReviewMistakes={() => setReviewOpen(true)} /></div>}
    {!reviewOpen && panel === "graph" && <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"><EvaluationReview points={reviewPoints} selectedPly={selectedPly} onSelect={onSelect} thresholds={thresholds} onThresholdsChange={setThresholds} /></div>}
    <footer className="border-t border-white/[0.07] p-3"><button className="w-full rounded-lg bg-[#7655dc]/20 px-3 py-2.5 text-sm font-medium hover:bg-[#7655dc]/30" onClick={() => setReviewOpen(true)}>Review My Mistakes</button></footer>
  </section>;
}

function byPositionResult(results: Saved[], position: Position) {
  return results.find((item) => item.ply === position.ply && item.fen === position.fen);
}

function classificationIcon(classification: MoveClassification) {
  return ({ Brilliant: "!!", Great: "!", Best: "★", Excellent: "✓", Good: "·", Inaccuracy: "?!", Mistake: "?", Blunder: "??", Book: "◇" })[classification];
}

function classificationColor(classification: MoveClassification) {
  return ({ Brilliant: "text-cyan-200", Great: "text-emerald-200", Best: "text-green-300", Excellent: "text-lime-200", Good: "text-gray-300", Inaccuracy: "text-amber-200", Mistake: "text-orange-300", Blunder: "text-rose-300", Book: "text-sky-200" })[classification];
}

function GameReviewSummary({ summary, onSelect, onReviewMistakes }: { summary: ReturnType<typeof summarizeClassifiedMoves>; onSelect: (ply: number) => void; onReviewMistakes: () => void }) {
  const labels: MoveClassification[] = ["Brilliant", "Great", "Best", "Excellent", "Good", "Inaccuracy", "Mistake", "Blunder", "Book"];
  return <section aria-label="Game review summary"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Game Review</h3><p className="mt-1 max-w-xl text-xs text-gray-400">Classifications use compatible saved analysis at depth 10 or higher. Excellent is ≤10 cp loss; Good is below your inaccuracy threshold. Mate scores and missing data are left unclassified.</p></div><button className="rounded-lg bg-[#7655dc]/25 px-3 py-2 text-xs hover:bg-[#7655dc]/35" onClick={onReviewMistakes}>Review My Mistakes</button></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{(["white", "black"] as const).map((color) => <div key={color} className="rounded-xl border border-white/[0.07] bg-black/15 p-3"><h4 className="font-medium">{color === "white" ? "White" : "Black"}</h4><div className="mt-2 grid grid-cols-3 gap-2">{labels.map((label) => <div key={label} className="rounded-lg bg-white/[0.035] px-2 py-1.5"><p className={`text-[10px] ${classificationColor(label)}`}>{label}</p><p className="text-lg font-semibold tabular-nums">{summary.byColor[color][label]}</p></div>)}</div></div>)}</div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><SummaryCount title="Classified moves" value={summary.bestMoves.length + summary.critical.length + summary.byColor.white.Excellent + summary.byColor.black.Excellent + summary.byColor.white.Good + summary.byColor.black.Good} /><SummaryCount title="Critical positions" value={summary.critical.length} /><SummaryCount title="Missed opportunities" value={summary.missedOpportunities.length} /></div>
    <h4 className="mt-5 text-sm font-medium">Critical positions & missed opportunities</h4>{summary.critical.length ? <div className="mt-2 space-y-1">{summary.critical.map((move) => <button key={move.ply} className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2 text-left text-sm hover:bg-white/[0.04]" onClick={() => onSelect(move.ply)}><span>{move.ply % 2 ? "White" : "Black"} · {Math.ceil(move.ply / 2)}{move.ply % 2 ? "." : "…"} {move.san} · <span className={classificationColor(move.classification!)}>{move.classification}</span></span><span className="text-xs text-gray-400">{move.lossCp} cp loss {move.bestMove ? `· best: ${move.bestMove}` : ""}</span></button>)}</div> : <p className="mt-2 text-xs text-gray-500">No classified critical positions in the compatible saved data.</p>}
    <p className="mt-4 text-[10px] leading-4 text-gray-500">No proprietary accuracy percentage is calculated. Brilliant/Great and Book are withheld: saved single-PV evaluations do not provide verified deep multi-PV exceptional-move evidence or a verified opening-book source.</p>
  </section>;
}

function SummaryCount({ title, value }: { title: string; value: number }) {
  return <div className="rounded-xl border border-white/[0.07] bg-[#0d0f16] p-3"><p className="text-xs text-gray-500">{title}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>;
}
