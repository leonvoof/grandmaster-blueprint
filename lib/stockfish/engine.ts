import { analysisPosition, parseUciInfo, uciVariationToSan, type Analysis } from "./position.ts";

export const ENGINE_BUILD = "Stockfish.js 19.0.1 Lite single-threaded";
export const ENGINE_SETTINGS = "threads=1;hash=16;multiPV=1;mode=depth";
export const STOCKFISH_WORKER = "/stockfish/19.0.1/stockfish-19-lite-single.js";
export const MIN_DEPTH = 6;
export const MAX_DEPTH = 18;
export const DEFAULT_DEPTH = 12;

type EngineWorker = Pick<Worker, "onmessage" | "onerror" | "onmessageerror" | "postMessage" | "terminate">;
type Progress = { phase: "starting" } | { phase: "searching"; depth: number };

export function runStockfish(
  fen: string,
  depth: number,
  signal: AbortSignal,
  onProgress: (progress: Progress) => void,
  createWorker: () => EngineWorker = () => new Worker(STOCKFISH_WORKER),
): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    if (!Number.isInteger(depth) || depth < MIN_DEPTH || depth > MAX_DEPTH) {
      return reject(new Error(`Choose a depth from ${MIN_DEPTH} to ${MAX_DEPTH}.`));
    }
    const { chess, terminal } = analysisPosition(fen);
    if (terminal) {
      const checkmate = chess.isCheckmate();
      return resolve({
        engine: ENGINE_BUILD, depth: 0, score: checkmate ? null : { kind: "cp", value: 0 },
        bestMove: null, variation: [], terminal,
      });
    }

    onProgress({ phase: "starting" });
    const worker = createWorker();
    let phase: "uci" | "ready" | "searching" = "uci";
    let engine = ENGINE_BUILD;
    let latest: ReturnType<typeof parseUciInfo> = null;
    let timeout: ReturnType<typeof setTimeout>;
    let settled = false;

    function cleanup() {
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      // Each search owns its worker. Termination also stops loads and synchronous WASM searches.
      worker.terminate();
    }

    function fail(error: unknown) {
      if (settled) return;
      cleanup();
      reject(error);
    }

    function abort() {
      fail(signal.reason);
    }

    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error("Stockfish could not start or stopped unexpectedly."));
    };
    worker.onmessageerror = () => fail(new Error("Could not read Stockfish output."));
    worker.onmessage = ({ data }) => {
      if (settled || typeof data !== "string") return;
      try {
        for (const line of data.trim().split(/\r?\n/)) {
          if (phase === "uci" && line.startsWith("id name ")) engine = line.slice(8).trim() || ENGINE_BUILD;
          if (phase === "uci" && line === "uciok") {
            phase = "ready";
            worker.postMessage("setoption name Hash value 16");
            worker.postMessage("setoption name MultiPV value 1");
            worker.postMessage("isready");
          } else if (phase === "ready" && line === "readyok") {
            phase = "searching";
            clearTimeout(timeout);
            timeout = setTimeout(() => fail(new Error("Stockfish search timed out. Try a lower depth.")), 45_000);
            onProgress({ phase, depth: 0 });
            worker.postMessage(`position fen ${chess.fen()}`);
            worker.postMessage(`go depth ${depth}`);
          } else if (phase === "searching") {
            const info = parseUciInfo(line, chess.turn() === "w");
            if (info && (!latest || info.depth >= latest.depth)) {
              latest = info;
              onProgress({ phase, depth: info.depth });
            } else if (line.startsWith("bestmove ")) {
              const move = line.split(/\s+/)[1];
              if (!latest || latest.moves[0] !== move) throw new Error("Stockfish did not return a complete line for this position.");
              const variation = uciVariationToSan(chess.fen(), latest.moves);
              cleanup();
              resolve({ engine, depth: latest.depth, score: latest.score, bestMove: variation[0], variation });
              return;
            }
          }
        }
      } catch (error) {
        fail(error);
      }
    };

    timeout = setTimeout(() => fail(new Error("Stockfish did not become ready. Try again.")), 20_000);
    if (signal.aborted) return abort();
    try {
      worker.postMessage("uci");
    } catch (error) {
      fail(error);
    }
  });
}
