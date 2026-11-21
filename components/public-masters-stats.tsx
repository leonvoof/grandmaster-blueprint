"use client";

import { useEffect, useState } from "react";
import { useMastersStatsConnection } from "@/components/public-masters-connection";
import { MastersAuthorizationExpired } from "@/lib/public-lichess-masters-auth";
import { formatMastersPercent, mastersPositionKey, type MastersStats, type MastersStatsLoader } from "@/lib/public-masters-stats";

const number = new Intl.NumberFormat("en-US");
const outcomes = ["White wins", "Draws", "Black wins"];
const colors = ["bg-[#d9efe4]", "bg-[#65ad9a]", "bg-[#344741]"];

export function PublicMastersStats({ fen }: { fen: string }) {
  const [open, setOpen] = useState(true);
  const { loader, onExpired } = useMastersStatsConnection();
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="min-w-0 rounded-xl border border-white/10 bg-[#0c1210] p-3 sm:p-4">
    <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[#70d6b8]">Masters statistics</summary>
    {open && <div className="mt-2 space-y-2">
      <p className="text-xs text-[#a4b5ab]">Lichess Masters game results and move popularity. Stockfish recommendations are shown separately.</p>
      {loader ? <PositionStats key={mastersPositionKey(fen)} fen={fen} loader={loader} onExpired={onExpired} /> :
        <p className="text-sm text-[#c1d6cb]">Connect Lichess to load Masters statistics.</p>}
    </div>}
  </details>;
}

function PositionStats({ fen, loader, onExpired }: { fen: string; loader: MastersStatsLoader; onExpired: () => void }) {
  const [stats, setStats] = useState<MastersStats>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const timer = window.setTimeout(async () => {
      try {
        const data = await loader.load(fen, signal);
        if (!signal.aborted) setStats(data);
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof MastersAuthorizationExpired) onExpired();
        else setError(error instanceof Error ? error.message : "Masters statistics are unavailable.");
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [fen, loader, onExpired, attempt]);

  if (error) return <div className="space-y-2 text-sm text-amber-100">
    <p role="status">{error}</p>
    <button type="button" className="rounded-lg border border-white/15 px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-[#70d6b8]"
      onClick={() => { setError(""); setStats(undefined); setAttempt((value) => value + 1); }}>Retry Masters statistics</button>
  </div>;
  if (!stats) return <p role="status" className="text-sm text-[#c1d6cb]">Loading Masters statistics…</p>;
  if (!stats.games) return <p role="status" className="text-sm text-[#c1d6cb]">No master games found for this position.</p>;

  return <>
    <p className="text-sm text-[#c1d6cb]"><strong className="text-[#a8eed8]">{number.format(stats.games)}</strong> sampled games</p>
    {stats.moves.length ? <ul aria-label="Masters continuations" className="divide-y divide-white/10">
      {stats.moves.map(({ san, games, frequency, results }) => <li key={san} className="space-y-1.5 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
          <strong className="font-mono text-[#a8eed8]">{san}</strong>
          <span className="tabular-nums text-[#c1d6cb]">{number.format(games)} {games === 1 ? "game" : "games"} · {formatMastersPercent(frequency)} of sample</span>
        </div>
        {results ? <>
          <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-white/10">
            {results.map((result, index) => <span key={outcomes[index]} className={colors[index]} style={{ width: `${result}%` }} />)}
          </div>
          <div className="flex flex-wrap justify-between gap-x-2 text-[11px] tabular-nums text-[#a4b5ab]">
            {results.map((result, index) => <span key={outcomes[index]}>{outcomes[index]} {formatMastersPercent(result)}</span>)}
          </div>
        </> : <p className="text-xs text-[#a4b5ab]">No results for this move.</p>}
      </li>)}
    </ul> : <p className="text-sm text-[#c1d6cb]">No recorded continuations for this position.</p>}
  </>;
}
