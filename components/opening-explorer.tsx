"use client";

import { useEffect, useMemo, useState } from "react";
import { mergeExplorerMoves, type ExplorerMove, type ExplorerSource, type RepertoireMoveRef } from "@/lib/opening-explorer";
import { StockfishAnalysis } from "@/components/stockfish-analysis";

type ExplorerResponse = {
  fen: string;
  source: ExplorerSource; sourceLabel: string; totalGames: number; white: number; draws: number; black: number;
  openingName: string | null; moves: ExplorerMove[];
  repertoireMoves: { uci: string; san: string; lines: RepertoireMoveRef[] }[];
  cached?: boolean; cache?: string;
};
type Props = { fen: string; repertoireId: string; chapterId: string; busy?: boolean; onNavigate: (san: string) => void; onAdd: (san: string) => void };

const ratingGroups = ["0", "1000", "1200", "1400", "1600", "1800", "2000", "2200", "2500"];

export function OpeningExplorer({ fen, repertoireId, chapterId, busy = false, onNavigate, onAdd }: Props) {
  const [source, setSource] = useState<ExplorerSource>("personal");
  const [speed, setSpeed] = useState("");
  const [ratingFrom, setRatingFrom] = useState("");
  const [ratingUntil, setRatingUntil] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [payload, setPayload] = useState<{ key: string; data: ExplorerResponse } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activeKey = JSON.stringify({ fen, source, speed: source === "masters" ? "" : speed, ratingFrom: source === "lichess" ? ratingFrom : "", ratingUntil: source === "lichess" ? ratingUntil : "", since, until });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ source, fen });
      if (since) query.set("since", since);
      if (until) query.set("until", until);
      if (source !== "masters" && speed) query.set("speed", speed);
      if (source === "lichess") {
        if (ratingFrom) query.set("ratingFrom", ratingFrom);
        if (ratingUntil) query.set("ratingUntil", ratingUntil);
      }
      setLoading(true); setError("");
      void fetch(`/api/openings/explorer?${query}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Opening explorer request failed.");
          return data as ExplorerResponse;
        })
        .then((data) => { if (!controller.signal.aborted) setPayload({ key: activeKey, data }); })
        .catch((cause) => { if (!controller.signal.aborted) { setPayload(null); setError(cause instanceof Error ? cause.message : "Opening data could not be loaded."); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeKey, fen, source, speed, ratingFrom, ratingUntil, since, until]);

  const currentPayload = payload?.key === activeKey ? payload.data : null;
  const rows = useMemo(() => currentPayload ? mergeExplorerMoves(fen, currentPayload.moves, currentPayload.repertoireMoves ?? []) : [], [fen, currentPayload]);
  const activeRatingUpper = ratingFrom ? ratingGroups.filter((rating) => Number(rating) > Number(ratingFrom)) : ratingGroups;
  const speedSupported = source !== "masters";
  const ratingSupported = source === "lichess";
  function changeSource(next: ExplorerSource) {
    setSource(next);
    if (next !== "lichess") { setRatingFrom(""); setRatingUntil(""); }
    if (next === "masters") setSpeed("");
  }

  return <section className="mt-5 rounded-xl border border-white/[0.08] bg-[#0c0e14] p-3" aria-label="Opening Explorer">
    <div className="flex items-start justify-between gap-2"><div><h2 className="text-sm font-medium">Opening Explorer</h2><p className="mt-1 text-[10px] text-gray-500">Follows the current board position. Popularity is descriptive, not a recommendation.</p></div>{loading && <span className="text-[10px] text-purple-200">Loading…</span>}</div>
    <div className="mt-3 grid gap-2">
      <label className="text-[10px] text-gray-400">Statistics source<select className="field mt-1 w-full" value={source} onChange={(event) => changeSource(event.target.value as ExplorerSource)}><option value="personal">My saved games and PGNs</option><option value="lichess">Lichess rated games · requires server token</option><option value="masters">Lichess Masters · requires server token</option></select></label>
      <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-gray-400">From<select className="field mt-1 w-full" value={ratingFrom} disabled={!ratingSupported} onChange={(event) => { setRatingFrom(event.target.value); if (ratingUntil && Number(event.target.value) >= Number(ratingUntil)) setRatingUntil(""); }}><option value="">Any</option>{ratingGroups.map((rating) => <option key={rating} value={rating}>{rating}+</option>)}</select></label><label className="text-[10px] text-gray-400">Below<select className="field mt-1 w-full" value={ratingUntil} disabled={!ratingSupported} onChange={(event) => setRatingUntil(event.target.value)}><option value="">No maximum</option>{activeRatingUpper.map((rating) => <option key={rating} value={rating}>{rating}</option>)}</select></label></div>
      <label className="text-[10px] text-gray-400">Time control{source === "personal" ? " · saved Lichess speed only" : ""}<select className="field mt-1 w-full" value={speed} disabled={!speedSupported} onChange={(event) => setSpeed(event.target.value)}><option value="">All available</option>{["ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-gray-400">From date<input className="field mt-1 w-full" type="month" value={since} onChange={(event) => setSince(event.target.value)} /></label><label className="text-[10px] text-gray-400">Through date<input className="field mt-1 w-full" type="month" value={until} onChange={(event) => setUntil(event.target.value)} /></label></div>
    </div>
    {source === "masters" && <p className="mt-2 text-[10px] text-gray-500">Time-control and rating filters are disabled for Masters data. Date filters are supported.</p>}
    {source === "personal" && <p className="mt-2 text-[10px] text-gray-500">Ratings are not consistently saved for personal games, so rating filtering is disabled. Time-control filtering only includes games with saved Lichess speed metadata.</p>}
    {error && <p role="alert" className="mt-3 rounded border border-amber-400/25 bg-amber-400/5 p-2 text-xs text-amber-200">{error}</p>}
    {currentPayload && <>
      <div className="mt-3 rounded-lg border border-white/[0.06] p-2"><div className="flex flex-wrap justify-between gap-1 text-[10px]"><b className="text-purple-200">{currentPayload.sourceLabel}</b><span className="text-gray-500">{currentPayload.totalGames.toLocaleString()} games · {currentPayload.cached ? "cached 60 sec" : currentPayload.cache ?? "live source"}</span></div>{currentPayload.openingName && <p className="mt-1 text-xs text-gray-300">Position opening: {currentPayload.openingName}</p>}<p className="mt-1 text-[10px] text-gray-500">Position outcomes: White {currentPayload.white.toLocaleString()} · Draw {currentPayload.draws.toLocaleString()} · Black {currentPayload.black.toLocaleString()}</p></div>
      <div className="mt-3 space-y-2">{rows.length ? rows.map((item) => {
        const alreadyInChapter = item.repertoireLines.some((line) => line.repertoireId === repertoireId && line.chapterId === chapterId);
        return <article key={item.uci} className="rounded-lg border border-white/[0.06] p-2">
          <div className="flex items-center justify-between gap-2"><button className="min-w-0 text-left text-sm font-medium text-gray-100 hover:text-purple-200" onClick={() => onNavigate(item.san)}>{item.san}<span className="ml-2 text-[10px] font-normal text-gray-500">{item.games.toLocaleString()} games · {(item.frequency * 100).toFixed(1)}%</span></button>{item.inRepertoire && <span className="shrink-0 rounded bg-emerald-400/10 px-1.5 py-1 text-[9px] text-emerald-200">In repertoire</span>}</div>
          <div className="mt-1 text-[9px] text-gray-500">White {item.white.toLocaleString()} · Draw {item.draws.toLocaleString()} · Black {item.black.toLocaleString()}{item.averageRating ? ` · Avg ${item.averageRating}` : ""}{item.openingName ? ` · ${item.openingName}` : ""}</div>
          {item.repertoireLines.length > 0 && <p className="mt-1 text-[9px] text-emerald-200/80">Saved: {item.repertoireLines.map((line) => `${line.repertoireName} / ${line.chapterName} / ${line.lineName}`).join("; ")}</p>}
          {item.games === 0 && item.inRepertoire && <p className="mt-1 text-[9px] text-gray-500">Saved repertoire move; no games for this move in the selected statistics source.</p>}
          {!alreadyInChapter && chapterId && <button className="mt-2 rounded border border-purple-400/25 px-2 py-1 text-[10px] text-purple-200 hover:bg-purple-400/10 disabled:opacity-50" disabled={busy} onClick={() => onAdd(item.san)}>Add to selected chapter</button>}
          {!chapterId && <p className="mt-2 text-[9px] text-gray-500">Select a chapter to add this move to a repertoire.</p>}
        </article>;
      }) : <p className="rounded-lg border border-white/[0.06] p-3 text-xs text-gray-400">No games contain a continuation from this position in the selected source. Saved repertoire continuations appear here with zero game counts.</p>}</div>
      <p className="mt-3 text-[9px] leading-4 text-gray-500">Repertoire membership is separate from game counts. Popular moves are not necessarily best moves. This panel does not substitute database popularity for an engine evaluation.</p>
    </>}
    <details className="mt-3 rounded-lg border border-white/[0.06] p-2"><summary className="cursor-pointer text-xs text-gray-300">Analyze this position with local Stockfish</summary><p className="mt-2 text-[10px] text-gray-500">On-demand local engine output is separate from database statistics and is not an opening-theory claim.</p><StockfishAnalysis fen={fen} gameId={null} /></details>
  </section>;
}
