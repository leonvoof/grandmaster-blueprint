import { Chess } from "chess.js";

export const openingLibraryPath = "/opening-library/lichess-cc0.json";
type NamedOpening = { eco: string; name: string; node: number };
export type OpeningEntry = NamedOpening & { id: number; family: string };
export type OpeningDataset = { revision: string; nodes: [parent: number, uci: string][]; entries: [eco: string, name: string, node: number][] };

const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function openingLibrary(dataset: OpeningDataset) {
  const entries = dataset.entries.map(([eco, name, node], id): OpeningEntry => ({
    eco, name, node, id, family: name.split(":")[0],
  }));
  const families = new Map<string, OpeningEntry[]>();
  const named = new Map<number, OpeningEntry[]>();
  const children = new Map<string, number>();
  for (const entry of entries) {
    if (!families.has(entry.family)) families.set(entry.family, []);
    if (!named.has(entry.node)) named.set(entry.node, []);
    families.get(entry.family)!.push(entry);
    named.get(entry.node)!.push(entry);
  }
  dataset.nodes.forEach(([parent, uci], id) => children.set(`${parent}:${uci}`, id));
  const searchable = entries.map((entry) => normalize(`${entry.eco} ${entry.name}`));
  return {
    entries, families,
    search(query: string) {
      const terms = normalize(query).split(" ").filter(Boolean);
      return entries.filter((entry) => terms.every((term) => searchable[entry.id].includes(term)));
    },
    recognize(line: readonly string[]) {
      let node = 0;
      for (const uci of line) {
        const next = children.get(`${node}:${uci}`);
        if (next === undefined) return [];
        node = next;
      }
      return named.get(node) ?? [];
    },
    line(entry: OpeningEntry) {
      const moves: string[] = [];
      for (let node = entry.node; node > 0; node = dataset.nodes[node][0]) moves.push(dataset.nodes[node][1]);
      return moves.reverse();
    },
  };
}

export type OpeningLibrary = ReturnType<typeof openingLibrary>;

export function openingPreview(library: OpeningLibrary, entry: OpeningEntry) {
  const chess = new Chess();
  return [{ fen: chess.fen(), san: "" }, ...library.line(entry).map((uci) => {
    const move = chess.move(uci);
    return { fen: chess.fen(), san: move.san };
  })];
}

let pendingLibrary: Promise<OpeningLibrary> | undefined;
export function loadOpeningLibrary() {
  pendingLibrary ??= fetch(openingLibraryPath)
    .then(async (response) => {
      if (!response.ok) throw new Error("Opening library is unavailable.");
      return openingLibrary(await response.json());
    })
    .catch((error) => {
      pendingLibrary = undefined;
      throw error;
    });
  return pendingLibrary;
}
