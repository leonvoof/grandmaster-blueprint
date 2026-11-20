import { Chess, type Move } from "chess.js";

export const maxRepertoires = 100;
export const maxRepertoireMoves = 600;
export const repertoireRoot = "root";

type MoveInput = { from: string; to: string; promotion?: string };
type Edge = MoveInput & { id: string; parent: string };
export type PublicRepertoire = { id: string; name: string; color: "white" | "black"; moves: Edge[] };
type Position = { id: string; parent: string | null; fen: string; san: string; ply: number; children: string[]; move?: Move };

export function repertoirePositions(moves: readonly Edge[]) {
  const positions = new Map<string, Position>();
  positions.set(repertoireRoot, { id: repertoireRoot, parent: null, fen: new Chess().fen(), san: "", ply: 0, children: [] });
  const siblings = new Set<string>();
  for (const edge of moves) {
    const parent = positions.get(edge.parent);
    if (!parent || positions.has(edge.id)) throw new Error("Invalid opening tree.");
    const chess = new Chess(parent.fen);
    const move = chess.move(edge);
    if (move.promotion !== edge.promotion) throw new Error("Invalid promotion.");
    const key = moveKey(edge.parent, move);
    if (siblings.has(key)) throw new Error("Duplicate opening branch.");
    siblings.add(key);
    parent.children.push(edge.id);
    positions.set(edge.id, { id: edge.id, parent: parent.id, fen: chess.fen(), san: move.san, ply: parent.ply + 1, children: [], move });
  }
  return positions;
}

function moveKey(parent: string, move: MoveInput) {
  return `${parent}:${move.from}${move.to}${move.promotion ?? ""}`;
}

export function addRepertoireMove(repertoire: PublicRepertoire, parent: string, input: MoveInput, id: string) {
  const position = repertoirePositions(repertoire.moves).get(parent);
  if (!position) throw new Error("This position is no longer available.");
  const move = new Chess(position.fen).move(input);
  const existing = repertoire.moves.find((edge) => moveKey(edge.parent, edge) === moveKey(parent, move));
  if (existing) return { repertoire, id: existing.id };
  if (repertoire.moves.length >= maxRepertoireMoves) throw new Error("This repertoire has reached 600 moves.");
  const edge = { id, parent, from: move.from, to: move.to, ...(move.promotion && { promotion: move.promotion }) };
  return { repertoire: { ...repertoire, moves: [...repertoire.moves, edge] }, id };
}

export function mergeRepertoireLines(repertoire: PublicRepertoire, lines: readonly (readonly string[])[], nextId: () => string) {
  const moves = [...repertoire.moves];
  const existing = new Map(moves.map((edge) => [moveKey(edge.parent, edge), edge.id]));
  for (const line of lines) {
    const chess = new Chess();
    let parent = repertoireRoot;
    for (const uci of line) {
      const { from, to, promotion } = chess.move(uci);
      const move = { from, to, ...(promotion && { promotion }) };
      const key = moveKey(parent, move);
      const saved = existing.get(key);
      if (saved) {
        parent = saved;
      } else {
        if (moves.length >= maxRepertoireMoves) throw new Error("This import exceeds the 600-move limit. Select fewer lines or use a new repertoire.");
        const id = nextId();
        moves.push({ ...move, id, parent });
        existing.set(key, id);
        parent = id;
      }
    }
  }
  return { ...repertoire, moves };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
const validSquare = (square: unknown): square is string => typeof square === "string" && /^[a-h][1-8]$/.test(square);

export function decodeRepertoires(input: unknown): PublicRepertoire[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > maxRepertoires) throw new Error("Invalid repertoire library.");
  const ids = new Set<string>();
  return input.map((item: unknown) => {
    if (!record(item) || !validId(item.id) || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 100
      || (item.color !== "white" && item.color !== "black") || !Array.isArray(item.moves) || item.moves.length > maxRepertoireMoves) {
      throw new Error("Invalid repertoire.");
    }
    ids.add(item.id);
    const moves = item.moves.map((edge: unknown): Edge => {
      if (!record(edge) || !validId(edge.id) || !(edge.parent === repertoireRoot || validId(edge.parent)) || !validSquare(edge.from) || !validSquare(edge.to)
        || (edge.promotion !== undefined && (typeof edge.promotion !== "string" || !["q", "r", "b", "n"].includes(edge.promotion)))) throw new Error("Invalid repertoire move.");
      const { id, parent, from, to, promotion } = edge;
      return { id, parent, from, to, ...(promotion && { promotion }) };
    });
    repertoirePositions(moves);
    return { id: item.id, name: item.name, color: item.color, moves };
  });
}
