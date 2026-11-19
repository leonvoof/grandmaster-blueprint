"use client";

import { useEffect, useRef, useState } from "react";
import { analysisKey, cacheAnalysis, readAnalysis } from "@/lib/stockfish/cache";
import { DEFAULT_DEPTH, MAX_DEPTH, MIN_DEPTH, runStockfish } from "@/lib/stockfish/engine";
import type { Analysis } from "@/lib/stockfish/position";

const buttonClass = "rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10";
type Props = { fen: string; gameId: string | null };

function formatScore(result: Analysis) {
  if (result.terminal) return result.terminal;
  const { score } = result;
  if (!score) return "Unavailable";
  if (score.kind === "mate") {
    if (score.value === 0) return "Checkmate";
    return `${score.value > 0 ? "White" : "Black"} mates in ${Math.abs(score.value)}`;
  }
  return `${score.value > 0 ? "+" : ""}${(score.value / 100).toFixed(2)}`;
}

export function StockfishAnalysis({ fen, gameId }: Props) {
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const key = analysisKey(gameId, fen, depth);
  return (
    <section className="mx-auto mt-5 w-full max-w-[560px] rounded-xl border border-white/10 p-4" aria-label="Stockfish analysis">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <h2 className="font-medium">Stockfish analysis</h2>
        <a className="text-xs text-gray-400 underline" href="/stockfish/19.0.1/NOTICE.txt">Engine license and source</a>
      </div>
      <p className="mt-1 text-xs text-gray-400">Evaluation from White’s perspective.</p>
      <PositionAnalysis key={key} fen={fen} cacheKey={key} depth={depth} setDepth={setDepth} />
    </section>
  );
}

function PositionAnalysis({ fen, cacheKey, depth, setDepth }: {
  fen: string; cacheKey: string; depth: number; setDepth: (depth: number) => void;
}) {
  const active = useRef<AbortController | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, []);

  async function analyze() {
    if (active.current) return;
    setError("");
    const cached = result ? null : readAnalysis(cacheKey);
    if (cached) {
      setResult(cached);
      setStatus("Loaded saved analysis.");
      return;
    }
    setResult(null);
    const controller = new AbortController();
    active.current = controller;
    setStatus("Starting Stockfish…");
    try {
      const analysis = await runStockfish(fen, depth, controller.signal, (progress) => {
        if (active.current !== controller || progress.phase !== "searching") return;
        setStatus(`Analyzing · depth ${progress.depth} / ${depth}`);
      });
      if (active.current !== controller) return;
      cacheAnalysis(cacheKey, analysis);
      setResult(analysis);
      setStatus("Analysis complete.");
    } catch (error) {
      if (active.current !== controller) return;
      setStatus("");
      setError(error instanceof Error ? error.message : "Stockfish analysis failed.");
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  function cancel() {
    active.current?.abort();
    active.current = null;
    setStatus("Analysis canceled.");
  }

  const busy = active.current !== null;
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          Depth
          <select className="rounded-lg border border-white/15 bg-[#0b0d13] px-2 py-2" value={depth} disabled={busy} onChange={(event) => setDepth(Number(event.target.value))}>
            {Array.from({ length: MAX_DEPTH - MIN_DEPTH + 1 }, (_, index) => index + MIN_DEPTH).map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        {busy
          ? <button type="button" className={buttonClass} onClick={cancel}>Cancel analysis</button>
          : <button type="button" className={`${buttonClass} bg-[#7655dc]/25`} onClick={analyze}>{result ? "Analyze again" : "Analyze position"}</button>}
      </div>
      <p className="mt-2 text-xs text-gray-400" role="status">{status}</p>
      {error && <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>}
      {result && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-gray-400">Evaluation</dt><dd>{formatScore(result)}</dd></div>
          <div><dt className="text-gray-400">Best move</dt><dd>{result.bestMove ?? "—"}</dd></div>
          <div><dt className="text-gray-400">Depth</dt><dd>{result.depth || "—"}</dd></div>
          <div><dt className="text-gray-400">Engine</dt><dd>{result.engine}</dd></div>
          {result.variation.length > 0 && <div className="col-span-2"><dt className="text-gray-400">Principal variation</dt><dd>{result.variation.join(" ")}</dd></div>}
        </dl>
      )}
    </>
  );
}
