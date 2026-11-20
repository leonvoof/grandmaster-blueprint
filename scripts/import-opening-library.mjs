import { Chess } from "chess.js";
import { writeFile } from "node:fs/promises";

const revision = "3ba6b20d31b2e6125cb0e6a2e792f400717d9d39";
const source = `https://raw.githubusercontent.com/lichess-org/chess-openings/${revision}/`;
async function download(file) {
  const response = await fetch(source + file);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

const files = await Promise.all([..."abcde"].map((letter) => download(letter + ".tsv")));
const license = await download("COPYING.txt");
const nodes = [[-1, ""]];
const edges = new Map();
const entries = [];
for (const file of files) {
  const [header, ...rows] = file.trimEnd().split(/\r?\n/);
  if (header !== "eco\tname\tpgn") throw new Error("Unexpected TSV columns.");
  for (const row of rows) {
    const [eco, name, pgn, ...extra] = row.split("\t");
    if (!/^[A-E]\d{2}$/.test(eco) || !name || !pgn || extra.length) throw new Error(`Invalid row: ${row}`);
    const chess = new Chess();
    chess.loadPgn(pgn, { strict: true });
    const moves = chess.history({ verbose: true });
    if (!moves.length) throw new Error(`Missing moves for ${name}`);
    let parent = 0;
    for (const { from, to, promotion } of moves) {
      const uci = from + to + (promotion ?? "");
      const key = `${parent}:${uci}`;
      if (!edges.has(key)) {
        edges.set(key, nodes.length);
        nodes.push([parent, uci]);
      }
      parent = edges.get(key);
    }
    entries.push([eco, name, parent]);
  }
}

await writeFile(new URL("../public/opening-library/lichess-cc0.json", import.meta.url), JSON.stringify({ revision, nodes, entries }) + "\n");
await writeFile(new URL("../public/opening-library/CC0.txt", import.meta.url), license);
console.log(`Imported ${entries.length} rows using ${nodes.length - 1} shared move nodes.`);
