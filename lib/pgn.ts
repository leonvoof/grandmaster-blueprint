import { Chess } from "chess.js";
import { createHash } from "node:crypto";

export function parsePgnCollection(input: string) {
  const chunks = input.trim().split(/(?=^\[Event\s)/m).filter((s) => s.trim());
  if (!chunks.length) throw new Error("No PGN games found.");
  return chunks.map((pgn) => {
    const chess = new Chess(); chess.loadPgn(pgn);
    const headers = chess.getHeaders();
    return { pgn: pgn.trim(), white: headers.White || "Unknown", black: headers.Black || "Unknown", date: headers.Date || null, result: headers.Result || null, opening: headers.Opening || headers.ECO || null, initialFen: headers.FEN || null, fingerprint: createHash("sha256").update(pgn.trim().replace(/\s+/g," ")).digest("hex") };
  });
}

export function positionAfter(moves: string[], ply: number) {
  const chess = new Chess();
  for (const san of moves.slice(0, Math.max(0, ply))) chess.move(san);
  return chess.fen();
}

export function lichessSiteId(pgn: string) {
  return pgn.match(/^\s*\[Site\s+"https:\/\/lichess\.org\/(?:game\/)?([a-zA-Z0-9]{8})(?:\/(?:white|black))?"\s*\]/m)?.[1];
}
