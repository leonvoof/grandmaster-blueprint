"use client";

import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { PublicBoard, type BoardMove } from "@/components/public-board";
import { useOpeningExplorerAnalysis } from "@/components/use-opening-explorer-analysis";
import { boardMoveAnnotation, boardSquareCell } from "@/lib/board-annotations";
import { evaluationBarState, shouldIgnoreGameViewerShortcut, whiteEvaluationFillEdge } from "@/lib/game-viewer-controls";
import { classifyEvaluationMove } from "@/lib/game-review-classification";
import { explorerKeys, openingExplorerTarget } from "@/lib/opening-explorer-session";
import { explorationPath, type ExplorationTree } from "@/lib/position-exploration";

export const explorerControl = "rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#70d6b8]";
export const explorerPanel = "min-w-0 rounded-xl border border-white/10 bg-[#0c1210] p-3 sm:p-4";
const thresholds = { inaccuracy: 50, mistake: 100, blunder: 200 };
const navigation = [
  ["Home", "Start", "⇤"], ["ArrowLeft", "Previous move", "←"],
  ["ArrowRight", "Next move", "→"], ["End", "End", "⇥"],
  ["ArrowUp", "Previous sibling", "↑"], ["ArrowDown", "Next sibling", "↓"],
] as const;

export function OpeningExplorerBoard({ tree, preferred, played, title, recognized, onSelect, onMove, moveError }: {
  tree: ExplorationTree;
  preferred: Record<string, string>;
  played: boolean;
  title: string;
  recognized: string;
  onSelect: (id: string) => void;
  onMove: (move: BoardMove) => boolean;
  moveError: string;
}) {
  const [black, setBlack] = useState(false);
  const [showArrow, setShowArrow] = useState(false);
  const notation = useRef<HTMLDivElement>(null);
  const current = tree.nodes[tree.currentId];
  const previous = current.parentId ? tree.nodes[current.parentId] : null;
  const { analysis, before, status, depth, retry } = useOpeningExplorerAnalysis(current.fen, played ? previous?.fen : undefined);
  const orientation = black ? "black" : "white";
  const score = evaluationBarState(analysis?.score ?? null, analysis?.terminal);
  const bestMove = analysis?.bestMove;
  const arrow = useMemo<[Square, Square] | null>(() => {
    if (!bestMove || !showArrow) return null;
    try {
      const { from, to } = new Chess(current.fen).move(bestMove);
      return [from, to];
    } catch { return null; }
  }, [current.fen, bestMove, showArrow]);
  const assessment = played && previous && current.san && before && analysis
    ? classifyEvaluationMove({ fen: previous.fen, played: current.san, before, after: analysis, thresholds })
    : null;
  const badge = boardMoveAnnotation(assessment?.classification);
  const square = current.to ? boardSquareCell(current.to, orientation) : null;
  const end = openingExplorerTarget(tree, preferred, "End") ?? current.id;
  const activeLine = explorationPath(tree, end);
  const compatibleChange = before?.score?.kind === "cp" && analysis?.score?.kind === "cp" && before.engine === analysis.engine
    && before.depth === analysis.depth && analysis.depth === depth
    ? (analysis.score.value - before.score.value) / 100 : null;

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || shouldIgnoreGameViewerShortcut(event.target)
        || (event.target instanceof HTMLElement && event.target.isContentEditable)
        || !explorerKeys.some((key) => key === event.key)) return;
      const id = openingExplorerTarget(tree, preferred, event.key);
      if (id && id !== current.id) {
        event.preventDefault();
        onSelect(id);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [tree, preferred, current.id, onSelect]);

  useEffect(() => {
    const panel = notation.current;
    const selected = panel?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!panel || !selected) return;
    const bounds = panel.getBoundingClientRect();
    const row = selected.getBoundingClientRect();
    if (row.top < bounds.top) panel.scrollTop -= bounds.top - row.top;
    if (row.bottom > bounds.bottom) panel.scrollTop += row.bottom - bounds.bottom;
  }, [current.id, end]);

  return <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
    <section className={explorerPanel}>
      <h3 className="break-words text-lg font-semibold">{title}</h3>
      {recognized && <p className="mt-1 break-words text-sm text-[#88ddc4]" aria-label="Recognized opening">{recognized}</p>}
      <div className="mx-auto mt-3 flex max-w-[588px] gap-2">
        <aside aria-label={`Evaluation bar, White perspective: ${score.label}`} className="mb-7 flex w-5 shrink-0 flex-col items-center gap-1 text-[9px] text-[#9bb2a7]">
          <span>{black ? "W" : "B"}</span>
          <div className="relative w-3 flex-1 overflow-hidden rounded-full border border-white/15 bg-[#080d0b]">
            {score.known && <div className="absolute inset-x-0 bg-[#e5f1eb] transition-[height] duration-200 motion-reduce:transition-none" style={{ [whiteEvaluationFillEdge(orientation)]: 0, height: `${score.whitePercent}%` }} />}
          </div>
          <span>{black ? "B" : "W"}</span>
        </aside>
        <div className="relative min-w-0 flex-1">
          <PublicBoard id="public-opening-explorer" fen={current.fen} move={onMove} black={black} green arrow={arrow} clickPromotion />
          {badge && square && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 grid aspect-square grid-cols-8 grid-rows-8">
            <span className="m-0.5 justify-self-end self-start rounded bg-black/80 px-1 text-xs font-bold"
              style={{ gridColumn: square.column + 1, gridRow: square.row + 1, color: badge.color }}>{badge.symbol}</span>
          </div>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Opening board navigation">
        {navigation.map(([key, label, glyph]) => {
          const target = openingExplorerTarget(tree, preferred, key);
          return <button key={key} className={explorerControl} type="button" aria-label={label} title={`${label} (${key})`}
            disabled={!target || target === current.id} onClick={() => target && onSelect(target)}>{glyph}</button>;
        })}
        <button className={explorerControl} onClick={() => setBlack(!black)}>Flip board</button>
      </div>
      {moveError && <p className="mt-2 text-sm text-amber-200" role="status">{moveError}</p>}
    </section>

    <div className="min-w-0 space-y-3">
      <section className={explorerPanel} aria-label="Stockfish analysis">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Stockfish</h3>
            <p className="mt-1 text-xs text-[#91a99d]" role="status">{analysis ? analysis.terminal ?? `Depth ${analysis.depth} · White perspective` : status?.error ? "Evaluation unavailable" : `Analyzing · depth ${status?.depth ?? 0} / ${depth}`}</p>
          </div>
          <span className="font-mono text-lg font-semibold text-[#a8eed8]" aria-label="White-perspective score">{score.known ? score.label : "—"}</span>
        </div>
        {status?.error && <div className="mt-2 space-y-2 text-xs text-amber-100"><p>{status.error}</p><button className={explorerControl} onClick={retry}>Retry analysis</button></div>}
        <label className="mt-2 flex items-center gap-2 text-xs text-[#a4b5ab]">
          <input type="checkbox" checked={showArrow} onChange={(event) => setShowArrow(event.target.checked)} /> Show Stockfish arrow
        </label>
        {bestMove && <p className="mt-3 text-sm">Best move <strong className="text-[#a8eed8]">{bestMove}</strong></p>}
        {analysis?.variation.length ? <p className="mt-1 break-words text-xs leading-relaxed text-[#c2d6ca]" aria-label="Principal variation">{analysis.variation.join(" ")}</p> : null}
        {played && current.san && <div className="mt-3 space-y-1 border-t border-white/10 pt-3 text-xs" aria-label="Move assessment">
          <p className="text-sm font-semibold" style={{ color: badge?.color }}>{current.san} · {assessment?.classification ?? "Assessment pending"}</p>
          {before?.bestMove && <p>Before the move, Stockfish preferred {before.bestMove}. {before.bestMove === current.san ? "Matched the top choice." : "Played a different move."}</p>}
          {compatibleChange !== null && <p>White evaluation change {compatibleChange >= 0 ? "+" : ""}{compatibleChange.toFixed(2)} pawns.</p>}
          {assessment && !assessment.classification && <p className="text-[#a4b5ab]">{assessment.reason}</p>}
        </div>}
      </section>

      <section className={explorerPanel}>
        <h3 className="text-sm font-semibold">Continuations</h3>
        <div className="mt-2 flex flex-wrap gap-1">
          {current.children.map((id) => {
            const node = tree.nodes[id];
            return <button className={explorerControl} key={id} onClick={() => onSelect(id)}>{node.san} <small className="text-[#a4b5ab]">{node.source === "game" ? "Recorded" : "Your branch"}</small></button>;
          })}
          {!current.children.length && <p className="text-sm text-[#a4b5ab]">Play a legal move to extend this line.</p>}
        </div>
      </section>

      <section className={explorerPanel}>
        <h3 className="text-sm font-semibold">Variation tree</h3>
        <div ref={notation} className="mt-2 max-h-56 space-y-1 overflow-y-auto" aria-label="Active line and alternatives">
          {activeLine.map((node) => {
            const siblings = node.parentId ? tree.nodes[node.parentId].children : [node.id];
            return <div key={node.id} className="flex flex-wrap items-center gap-1">
              <span className="min-w-8 text-xs text-[#a4b5ab]">{node.ply ? `${Math.ceil(node.ply / 2)}${node.ply % 2 ? "." : "…"}` : ""}</span>
              {siblings.map((id) => {
                const alternative = tree.nodes[id];
                return <button key={id} onClick={() => onSelect(id)} aria-current={current.id === id ? "step" : undefined}
                  className={`rounded-md border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-[#70d6b8] ${node.id === id ? "border-[#70d6b8]/25 text-[#a8eed8]" : "border-white/10 text-[#9eb0a7]"} aria-[current=step]:bg-[#70d6b8]/20`}>
                  {alternative.san ?? "Start"}{alternative.source === "exploration" && <small className="ml-1 text-amber-200">Your branch</small>}
                </button>;
              })}
            </div>;
          })}
        </div>
      </section>
    </div>
  </div>;
}
