"use client";
import type { findCriticalMoves, ReviewPoint } from "@/lib/evaluation-review";

export function EvaluationReview({ points, critical, selectedPly, onSelect, thresholds, onThresholdsChange }: { points: ReviewPoint[]; critical: ReturnType<typeof findCriticalMoves>; selectedPly: number; onSelect: (ply: number) => void; thresholds: { inaccuracy: number; mistake: number; blunder: number }; onThresholdsChange: (thresholds: { inaccuracy: number; mistake: number; blunder: number }) => void }) {
  function update(key: keyof typeof thresholds, value: string) {
    const amount = Number(value);
    if (Number.isInteger(amount) && amount >= 0) onThresholdsChange({ ...thresholds, [key]: amount });
  }
  const vals = points.map((point) => point.evaluation).filter((n): n is number => n !== null);
  const min = Math.min(-2, ...vals), max = Math.max(2, ...vals);
  const x = (ply: number) => 36 + (points.length <= 1 ? 0 : (ply / (points.length - 1)) * 584);
  const y = (value: number) => 152 - ((value - min) / (max - min)) * 128;
  return <section className="mt-5 rounded-xl border border-white/10 p-4"><h3 className="font-medium">Evaluation and move review</h3><p className="mt-1 text-xs text-gray-400">Evaluations are from White’s perspective. Penalty labels require both a centipawn loss and a drop in estimated expected score for the mover. Mate scores are shown separately.</p>
    <label className="mt-2 flex gap-2 text-xs">Minimum losses (cp)<input aria-label="Inaccuracy threshold" className="w-14 bg-black/30 p-1" type="number" value={thresholds.inaccuracy} onChange={(event) => update("inaccuracy", event.target.value)}/><input aria-label="Mistake threshold" className="w-14 bg-black/30 p-1" type="number" value={thresholds.mistake} onChange={(event) => update("mistake", event.target.value)}/><input aria-label="Blunder threshold" className="w-14 bg-black/30 p-1" type="number" value={thresholds.blunder} onChange={(event) => update("blunder", event.target.value)}/></label>
    <svg viewBox="0 0 640 180" className="mt-2 w-full" role="img" aria-label="White-perspective evaluation graph with gaps for unanalyzed positions">
      {[0, 1, 2, 3, 4].map((line) => <g key={line}><line x1="36" x2="620" y1={20 + line * 32} y2={20 + line * 32} stroke="#ffffff18"/><text x="2" y={24 + line * 32} fill="#999" fontSize="10">{(max - (line / 4) * (max - min)).toFixed(1)}</text></g>)}
      {points.map((point, index) => point.evaluation === null || index === 0 || points[index - 1].evaluation === null ? null : <line key={`segment-${point.ply}`} x1={x(points[index - 1].ply)} y1={y(points[index - 1].evaluation!)} x2={x(point.ply)} y2={y(point.evaluation)} stroke="#a58aff" strokeWidth="2"/>)}
      {points.map((point) => point.evaluation === null && point.mate === null ? null : <circle key={point.ply} cx={x(point.ply)} cy={y(point.evaluation ?? (point.mate! > 0 ? max : min))} r={point.ply === selectedPly ? 6 : 4} fill={point.ply === selectedPly ? "#fff" : critical.some((item) => item.ply === point.ply) ? "#fb7185" : "#a58aff"} role="button" tabIndex={0} aria-label={`Move ${point.ply}, ${point.evaluation === null ? `mate ${point.mate}` : `${point.evaluation.toFixed(2)} pawns`}`} onClick={() => onSelect(point.ply)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(point.ply); }}><title>{point.evaluation === null ? `Mate ${point.mate}` : `${point.evaluation.toFixed(2)} pawns`}</title></circle>)}
      {points.filter((point) => point.ply % 2 === 0).map((point) => <text key={`move-${point.ply}`} x={x(point.ply)} y="174" fill="#aaa" fontSize="9">{point.ply / 2 + 1}</text>)}
    </svg>
    <div className="mt-3 space-y-2">{critical.map((move) => <button key={move.ply} onClick={() => onSelect(move.ply)} className="block w-full rounded-lg border border-rose-400/20 p-3 text-left text-sm hover:bg-white/5"><strong>{move.moveNumber}{move.color === "white" ? "." : "…"} {move.san} · {move.classification}</strong><div className="mt-1 text-xs text-gray-300">{move.before.toFixed(2)} → {move.after.toFixed(2)} · loss {move.loss.toFixed(2)} · best alternative before move: {move.alternative ?? "Unavailable"}</div><div className="mt-1 text-xs text-gray-400">Engine continuation: {move.variation.join(" ") || "Unavailable"}</div></button>)}</div>
  </section>;
}
