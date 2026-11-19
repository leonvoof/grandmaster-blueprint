import { ENGINE_BUILD, ENGINE_SETTINGS } from "./engine";
import type { Analysis } from "./position";

const storageKey = "grandmaster-blueprint:stockfish-cache:v1";
const maxResults = 64;
type Entry = { key: string; analysis: Analysis };

function entries(): Entry[] {
  const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
  return Array.isArray(value) ? value : [];
}

export function analysisKey(gameId: string | null, fen: string, depth: number) {
  return JSON.stringify([gameId, fen, ENGINE_BUILD, ENGINE_SETTINGS, depth]);
}

export function readAnalysis(key: string) {
  try {
    return entries().find((entry) => entry.key === key)?.analysis ?? null;
  } catch {
    return null;
  }
}

export function cacheAnalysis(key: string, analysis: Analysis) {
  try {
    const next = [{ key, analysis }, ...entries().filter((entry) => entry.key !== key)].slice(0, maxResults);
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Analysis is still usable if browser storage is unavailable or full.
  }
}
