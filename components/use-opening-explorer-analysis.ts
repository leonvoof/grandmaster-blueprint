"use client";

import { useEffect, useRef, useState } from "react";
import { analysisKey, cacheAnalysis, readAnalysis } from "@/lib/stockfish/cache";
import { DEFAULT_DEPTH, ENGINE_BUILD, runStockfish } from "@/lib/stockfish/engine";
import type { Analysis } from "@/lib/stockfish/position";

export function useOpeningExplorerAnalysis(fen: string, parentFen?: string) {
  const results = useRef(new Map<string, Analysis>());
  const [status, setStatus] = useState<{ fen: string; depth?: number; error?: string }>({ fen });
  const [retry, setRetry] = useState(0);
  const depth = DEFAULT_DEPTH;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const timeout = window.setTimeout(async () => {
      try {
        for (const position of new Set([fen, ...(parentFen ? [parentFen] : [])])) {
          const key = analysisKey(null, position, depth);
          let analysis = results.current.get(position) ?? readAnalysis(key);
          if (!analysis || analysis.engine !== ENGINE_BUILD || (analysis.depth !== depth && !analysis.terminal)) {
            const result = await runStockfish(position, depth, signal, (progress) => {
              if (!signal.aborted && position === fen) setStatus({ fen, depth: progress.phase === "searching" ? progress.depth : 0 });
            });
            if (signal.aborted) return;
            analysis = { ...result, engine: ENGINE_BUILD };
            if (analysis.depth === depth || analysis.terminal) cacheAnalysis(key, analysis);
          }
          if (signal.aborted) return;
          if (results.current.size >= 1024 && !results.current.has(position)) {
            const oldest = [...results.current.keys()].find((key) => key !== fen && key !== parentFen);
            if (oldest) results.current.delete(oldest);
          }
          results.current.set(position, analysis);
          setStatus({ fen });
        }
      } catch (error) {
        if (!signal.aborted) setStatus({ fen, error: error instanceof Error ? error.message : "Stockfish could not search this position." });
      }
    }, 85);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [fen, parentFen, depth, retry]);

  return {
    analysis: results.current.get(fen) ?? null,
    before: parentFen ? results.current.get(parentFen) ?? null : null,
    status: status.fen === fen ? status : undefined,
    depth,
    retry: () => { setStatus({ fen }); setRetry((value) => value + 1); },
  };
}
