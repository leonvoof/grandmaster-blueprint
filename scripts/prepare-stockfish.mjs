import { copyFile, mkdir, readFile } from "node:fs/promises";

const upstream = new URL("../node_modules/stockfish/", import.meta.url);
const destination = new URL("../public/stockfish/19.0.1/", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", upstream), "utf8"));
if (version !== "19.0.1") throw new Error("Stockfish assets and notices must match the pinned version.");
await mkdir(destination, { recursive: true });
await Promise.all([
  "bin/stockfish-19-lite-single.js",
  "bin/stockfish-19-lite-single.wasm",
  "Copying.txt",
].map((path) => copyFile(new URL(path, upstream), new URL(path.split("/").at(-1), destination))));
