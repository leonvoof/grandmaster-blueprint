import type { Analysis } from "@/lib/stockfish/position";

export type GamePosition = { fen: string; ply: number; san: string | null };
type Options = {
  positions: GamePosition[];
  signal: AbortSignal;
  load: (position: GamePosition) => Promise<Analysis | null>;
  analyze: (position: GamePosition) => Promise<Analysis>;
  save: (position: GamePosition, analysis: Analysis) => Promise<void>;
  complete: (position: GamePosition, analysis: Analysis) => void;
};

export async function analyzePositionsSequentially({ positions, signal, load, analyze, save, complete }: Options) {
  let completed = 0;
  for (const position of positions) {
    if (signal.aborted) break;
    let result = await load(position);
    if (signal.aborted) break;
    if (!result) result = await analyze(position);
    if (signal.aborted) break;
    await save(position, result);
    if (signal.aborted) break;
    complete(position, result);
    completed++;
  }
  return completed;
}
