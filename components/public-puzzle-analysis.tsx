"use client";

import { useEffect, useRef, useState } from "react";
import { PublicBoard, type BoardMove } from "@/components/public-board";
import { useOpeningExplorerAnalysis } from "@/components/use-opening-explorer-analysis";
import { evaluationBarState, whiteEvaluationFillEdge } from "@/lib/game-viewer-controls";
import { addExplorationMove, explorationPath, selectExplorationNode, type ExplorationTree } from "@/lib/position-exploration";

const panel = "min-w-0 rounded-xl border border-white/10 bg-[#0c1210] p-3 sm:p-4";

export function PublicPuzzleAnalysis({ baseline, black, onReturn }: { baseline: ExplorationTree; black: boolean; onReturn: () => void }) {
  const [tree, setTree] = useState(baseline);
  const [preferred, setPreferred] = useState<Record<string, string>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const current = tree.nodes[tree.currentId];
  const next = preferred[current.id] ?? current.children[0];
  const path = explorationPath(tree);
  const { analysis, status, depth, retry } = useOpeningExplorerAnalysis(current.fen);
  const score = evaluationBarState(analysis?.score ?? null, analysis?.terminal);

  function select(id: string) {
    const selected = selectExplorationNode(tree, id);
    const parentId = selected.nodes[id].parentId;
    if (parentId !== null) setPreferred((previous) => ({ ...previous, [parentId]: id }));
    setTree(selected);
  }

  function play(move: BoardMove) {
    const promotion = move.promotion ?? "q";
    if (promotion !== "q" && promotion !== "r" && promotion !== "b" && promotion !== "n") return false;
    try {
      const added = addExplorationMove(tree, move.from, move.to, promotion);
      setPreferred((previous) => ({ ...previous, [current.id]: added.tree.currentId }));
      setTree(added.tree);
      return true;
    } catch {
      return false;
    }
  }

  return <section aria-label="Puzzle analysis" className="mt-4 rounded-xl border border-[#70d6b8]/20 bg-[#111815] p-3 sm:p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold text-[#a8eed8]">Puzzle analysis</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={onReturn}>Return to Puzzle</button>
        <button type="button" className="btn" onClick={() => { setTree(baseline); setPreferred({}); }}>Reset Analysis</button>
      </div>
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className={panel}>
        <div className="mx-auto flex max-w-[588px] gap-2">
          <aside aria-label={`Evaluation bar, White perspective: ${score.known ? score.label : "Pending"}`} className="mb-7 flex w-5 shrink-0 flex-col items-center gap-1 text-[10px] text-[#a4b5ab]">
            <span>{black ? "W" : "B"}</span>
            <div className="relative w-3 flex-1 overflow-hidden rounded-full border border-white/15 bg-[#080d0b]">
              {score.known && <div className="absolute inset-x-0 bg-[#e5f1eb] transition-[height] duration-200 motion-reduce:transition-none"
                style={{ [whiteEvaluationFillEdge(black ? "black" : "white")]: 0, height: `${score.whitePercent}%` }} />}
            </div>
            <span>{black ? "B" : "W"}</span>
          </aside>
          <div className="min-w-0 flex-1"><PublicBoard id="public-puzzle-analysis" fen={current.fen} move={play} black={black} green clickPromotion /></div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Puzzle analysis navigation">
          <button type="button" className="btn" disabled={current.parentId === null} onClick={() => current.parentId !== null && select(current.parentId)}>Previous Move</button>
          <button type="button" className="btn" disabled={!next} onClick={() => next && select(next)}>Next Move</button>
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <section className={panel} aria-label="Puzzle Stockfish analysis">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">Stockfish</h4>
              <p role="status" className="mt-1 text-xs text-[#a4b5ab]">{analysis?.terminal ??
                (analysis ? `Depth ${analysis.depth} · White perspective` : status?.error ? "Evaluation unavailable" : `Analyzing · depth ${status?.depth ?? 0} / ${depth}`)}</p>
            </div>
            <span aria-label="White-perspective score" className="font-mono font-semibold text-[#a8eed8]">{score.known ? score.label : "—"}</span>
          </div>
          {status?.error && <div className="mt-2 space-y-2 break-words text-xs text-amber-100"><p>{status.error}</p><button type="button" className="btn" onClick={retry}>Retry analysis</button></div>}
          {analysis?.bestMove && <p className="mt-2 text-sm">Best move <strong className="text-[#a8eed8]">{analysis.bestMove}</strong></p>}
          {analysis?.variation.length ? <p aria-label="Principal variation" className="mt-1 break-words text-xs leading-relaxed text-[#c2d6ca]">{analysis.variation.join(" ")}</p> : null}
        </section>

        <section className={panel}>
          <h4 className="text-sm font-semibold">Explored line</h4>
          <div aria-label="Explored line" className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {path.map((node) => <button type="button" key={node.id} className="btn aria-[current=step]:border-[#70d6b8]/40 aria-[current=step]:text-[#a8eed8]"
              aria-current={current.id === node.id ? "step" : undefined} onClick={() => select(node.id)}>{node.san ?? "Puzzle start"}</button>)}
          </div>
          {current.children.length > 0 && <div className="mt-3">
            <h5 className="text-xs text-[#a4b5ab]">Continuations</h5>
            <div aria-label="Explored continuations" className="mt-1 flex flex-wrap gap-1.5">
              {current.children.map((id) => <button type="button" className="btn" key={id} onClick={() => select(id)}>{tree.nodes[id].san}</button>)}
            </div>
          </div>}
        </section>
      </div>
    </div>
  </section>;
}
