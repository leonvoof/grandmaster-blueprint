import { Chess } from "chess.js";

export function exportOpeningLine(pgn: string, notes: { fen: string; text: string }[] = []) {
  const source = new Chess();
  source.loadPgn(pgn);
  const headers = source.getHeaders();
  const chess = new Chess(headers.FEN);
  chess.header(...Object.entries(headers).flatMap(([key, value]) => [key, value]));
  const comments = new Map(notes.map((note) => [note.fen, note.text]));
  for (const move of source.history({ verbose: true })) {
    chess.move(move.san);
    const comment = comments.get(chess.fen());
    if (comment) chess.setComment(comment);
  }
  return chess.pgn();
}

export function exportOpeningDocument(chapters: { lines: { pgn: string }[]; notes?: { fen: string; text: string }[] }[]) {
  return chapters.flatMap((chapter) => chapter.lines.map((line) => exportOpeningLine(line.pgn, chapter.notes ?? []))).join("\n\n");
}
