import { ENGINE_BUILD } from "./stockfish/engine.ts";
import { Chess } from "chess.js";
import { validateVariationEdges, type SavedBranch } from "./public-exploration.ts";
import type { Analysis } from "@/lib/stockfish/position";

export type SavedAnalysis = { id: string; gameId: string; fen: string; ply: number; engine: string; settings: string; depth: number; scoreType: "cp" | "mate" | null; scoreValue: number | null; bestMove: string | null; variation: string; terminal: string | null };
export type Reflection = { thinking: string; overlooked: string; variations: string; learned: string; recognition: string };
export type ReviewEvent = { id: string; kind: string; submittedSan: string | null; matchedBest: boolean | null; createdAt: string };
export type SavedReview = { analysisId: string; reflection: Reflection; events: ReviewEvent[] };
export const blankReflection: Reflection = { thinking: "", overlooked: "", variations: "", learned: "", recognition: "" };

type VariationRecord = { id: string; edges: SavedBranch[] };
type RecordValue = SavedAnalysis | SavedReview | VariationRecord;
type Store = "analyses" | "reviews" | "variations";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("knightforge-game-review", 2);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion < 2) request.result.createObjectStore("variations");
      for (const store of event.oldVersion < 1 ? ["analyses", "reviews"] : []) {
        request.result.createObjectStore(store).createIndex("game", "gameId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not open browser review storage."));
  });
}

async function transact<T>(stores: Store[], mode: IDBTransactionMode, operation: (tx: IDBTransaction, result: (value: T) => void) => void) {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error("Browser review storage could not be updated."));
      operation(tx, (next) => { value = next; });
    });
  } finally { db.close(); }
}

function list<T extends RecordValue>(store: Store, gameId?: string) {
  return transact<T[]>([store], "readonly", (tx, result) => {
    const objects = tx.objectStore(store);
    const request = gameId === undefined ? objects.getAll() : objects.index("game").getAll(gameId);
    request.onsuccess = () => result(request.result);
  });
}

export async function browserGameId(pgn: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pgn.trim()));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export const readBrowserAnalyses = (gameId: string) => list<SavedAnalysis>("analyses", gameId);
export const readBrowserReviews = (gameId: string) => list<SavedReview>("reviews", gameId);

export async function saveBrowserAnalysis(gameId: string, ply: number, fen: string, settings: string, analysis: Analysis, depth: number) {
  const id = JSON.stringify([gameId, ply, fen, ENGINE_BUILD, settings, depth]);
  const record: SavedAnalysis = { id, gameId, ply, fen, engine: ENGINE_BUILD, settings, depth, scoreType: analysis.score?.kind ?? null,
    scoreValue: analysis.score?.value ?? null, bestMove: analysis.bestMove, variation: JSON.stringify(analysis.variation), terminal: analysis.terminal ?? null };
  await transact<void>(["analyses"], "readwrite", (tx) => { tx.objectStore("analyses").put(record, id); });
  return record;
}

export function saveBrowserReview(gameId: string, analysisId: string, fen: string, alternative: string | null, action: string, extra: Record<string, unknown>) {
  const reflection = action === "save-reflection" ? validateReflection(extra.reflection) : null;
  const submittedSan = action === "submit" && typeof extra.move === "string" ? new Chess(fen).move(extra.move).san : null;
  if (!reflection && action !== "hint" && action !== "reveal" && !submittedSan) throw new Error("Invalid review action.");
  return transact<{ type: "reflection"; reflection: Reflection } | { type: "event"; event: ReviewEvent; firstAttempt: boolean }>(["reviews"], "readwrite", (tx, result) => {
    const store = tx.objectStore("reviews");
    const request = store.get(analysisId);
    request.onsuccess = () => {
      const old = (request.result as SavedReview | undefined) ?? { analysisId, reflection: blankReflection, events: [] };
      if (reflection) {
        store.put({ ...old, gameId, reflection }, analysisId);
        result({ type: "reflection", reflection });
      } else {
        const event = { id: crypto.randomUUID(), kind: action, submittedSan, matchedBest: submittedSan && alternative ? submittedSan === alternative : null, createdAt: new Date().toISOString() };
        store.put({ ...old, gameId, events: [...old.events, event] }, analysisId);
        result({ type: "event", event, firstAttempt: !old.events.some((entry) => entry.kind === "submit") });
      }
    };
  });
}

function validateReflection(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid reflection.");
  const record = value as Reflection;
  const keys = Object.keys(blankReflection) as (keyof Reflection)[];
  if (keys.some((key) => typeof record[key] !== "string" || record[key].length > 4000)) throw new Error("Reflection fields must be under 4,000 characters.");
  return Object.fromEntries(keys.map((key) => [key, record[key]])) as Reflection;
}

export function readBrowserVariation(id: string) {
  return transact<SavedBranch[]>(["variations"], "readonly", (tx, result) => {
    const request = tx.objectStore("variations").get(id);
    request.onsuccess = () => result(request.result?.edges ?? []);
  });
}

export function saveBrowserVariation(id: string, edges: SavedBranch[]) {
  return transact<void>(["variations"], "readwrite", (tx) => {
    tx.objectStore("variations").put({ id, edges: validateVariationEdges(edges) }, id);
  });
}

export async function exportBrowserReviews() {
  const [analyses, reviews, variations] = await Promise.all([list<SavedAnalysis>("analyses"), list<SavedReview & { gameId: string }>("reviews"), list<VariationRecord>("variations")]);
  return { analyses, reviews, variations };
}

export async function restoreBrowserReviews(input: unknown, commitProgress: () => void) {
  if (input === undefined) { commitProgress(); return; }
  const { analyses, reviews, variations = [] } = (input ?? {}) as Awaited<ReturnType<typeof exportBrowserReviews>>;
  if (!Array.isArray(analyses) || !Array.isArray(reviews) || !Array.isArray(variations)) throw new Error("Invalid game review backup.");
  const games = new Map<string, SavedAnalysis>();
  for (const row of analyses) {
    if (!row || !/^[a-f0-9]{64}$/.test(row.gameId) || typeof row.fen !== "string" || !Number.isInteger(row.ply) || row.ply < 0 || row.ply > 600
      || typeof row.engine !== "string" || typeof row.settings !== "string" || !Number.isInteger(row.depth) || row.depth < 1 || row.depth > 99
      || (row.scoreType === null ? row.scoreValue !== null : !["cp", "mate"].includes(row.scoreType) || !Number.isSafeInteger(row.scoreValue))
      || typeof row.variation !== "string" || (row.bestMove !== null && typeof row.bestMove !== "string")
      || (row.terminal !== null && !["White is checkmated", "Black is checkmated", "Stalemate", "Insufficient material", "75-move rule"].includes(row.terminal))
      || row.id !== JSON.stringify([row.gameId, row.ply, row.fen, row.engine, row.settings, row.depth]) || games.has(row.id)) throw new Error("Invalid saved analysis.");
    const chess = new Chess(row.fen);
    const line: unknown = JSON.parse(row.variation);
    if (!Array.isArray(line) || !line.every((san) => typeof san === "string" && chess.move(san).san === san) || (line[0] ?? null) !== row.bestMove) throw new Error("Invalid engine continuation.");
    games.set(row.id, row);
  }
  for (const row of reviews) {
    if (!row || games.get(row.analysisId)?.gameId !== row.gameId || !Array.isArray(row.events) || !row.events.every((event) => event && typeof event.id === "string"
      && ["submit", "hint", "reveal"].includes(event.kind) && Number.isFinite(Date.parse(event.createdAt))
      && (event.submittedSan === null || typeof event.submittedSan === "string") && (event.matchedBest === null || typeof event.matchedBest === "boolean"))) throw new Error("Invalid review history.");
    row.reflection = validateReflection(row.reflection);
  }
  const trees = variations.map(({ id, edges }) => {
    if (typeof id !== "string" || (!/^[a-f0-9]{64}$/.test(id) && !id.startsWith("fen:"))) throw new Error("Invalid variation identity.");
    if (id.startsWith("fen:")) new Chess(id.slice(4));
    return { id, edges: validateVariationEdges(edges) };
  });
  await transact<void>(["analyses", "reviews", "variations"], "readwrite", (tx) => {
    const a = tx.objectStore("analyses"), r = tx.objectStore("reviews");
    const v = tx.objectStore("variations");
    a.clear(); r.clear(); v.clear();
    for (const row of trees) v.put(row, row.id);
    for (const row of analyses) a.put(row, row.id);
    for (const row of reviews) r.put(row, row.analysisId);
    const finalCheck = r.count();
    finalCheck.onsuccess = () => { try { commitProgress(); } catch { tx.abort(); } };
  });
}
