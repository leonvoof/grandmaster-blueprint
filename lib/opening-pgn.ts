import { Chess } from "chess.js";
import { parseGames, type ParseTree } from "@mliebelt/pgn-parser";
import { lineMoves } from "@/lib/opening-tree";

export type ImportedOpeningGame = { name: string; pgn: string; lines: { name: string; pgn: string }[]; notes: { fen: string; text: string }[] };

export function parseOpeningPgn(input: string): ImportedOpeningGame[] {
  const trees = parseGames(input);
  if (!trees.length) throw new Error("No PGN games found.");
  return trees.map((tree, gameIndex) => parseGame(tree, gameIndex));
}

function parseGame(tree: ParseTree, gameIndex: number): ImportedOpeningGame {
  const tags = (tree.tags ?? {}) as Record<string, unknown>;
  const startFen = typeof tags.FEN === "string" ? tags.FEN : undefined;
  const start = () => new Chess(startFen);
  const lines: { name: string; pgn: string }[] = [];
  const notes = new Map<string, string>();
  const main = validateSequence(tree.moves, start(), [], tags, lines, notes, `Game ${gameIndex + 1}`);
  if (!main.length) throw new Error(`Game ${gameIndex + 1} contains no moves.`);
  const unique = new Map<string, { name: string; pgn: string }>();
  for (const line of lines) unique.set(lineMoves(line.pgn).join(" "), line);
  const mainline = render(tags, main, startFen, notes);
  unique.set(lineMoves(mainline).join(" "), { name: typeof tags.Opening === "string" ? tags.Opening : `Game ${gameIndex + 1} main line`, pgn: mainline });
  return { name: typeof tags.Opening === "string" ? tags.Opening : typeof tags.Event === "string" ? tags.Event : `Imported game ${gameIndex + 1}`, pgn: mainline, lines: [...unique.values()], notes: [...notes].map(([fen, text]) => ({ fen, text })) };
}

function validateSequence(nodes: ParseTree["moves"], chess: Chess, prefix: string[], tags: Record<string, unknown>, lines: { name: string; pgn: string }[], notes: Map<string, string>, label: string): string[] {
  const played = [...prefix];
  for (const node of nodes) {
    const branchStart = [...played];
    const san = node.notation.notation;
    try { chess.move(san); } catch { throw new Error(`Illegal PGN move ${san} in ${label}.`); }
    played.push(chess.history().at(-1)!);
    const comment = node.commentAfter ?? node.commentDiag?.comment;
    if (comment) notes.set(chess.fen(), comment);
    const annotations = node.nag?.join(" ") ?? (node.commentDiag as unknown as { nag?: string } | null)?.nag;
    if (annotations) notes.set(chess.fen(), [notes.get(chess.fen()), `[%nag ${annotations}]`].filter(Boolean).join(" "));
    for (const [index, variation] of node.variations.entries()) {
      const branchChess = new Chess(typeof tags?.FEN === "string" ? tags.FEN : undefined);
      try { for (const move of branchStart) branchChess.move(move); }
      catch { throw new Error(`Could not restore variation start in ${label}.`); }
      const branch = validateSequence(variation, branchChess, branchStart, tags, lines, notes, `${label}, variation ${index + 1}`);
      if (branch.length > branchStart.length) lines.push({ name: `${label} variation ${lines.length + 1}`, pgn: render(tags, branch, typeof tags?.FEN === "string" ? tags.FEN : undefined, notes) });
    }
  }
  return played;
}

function render(tags: Record<string, unknown>, moves: string[], fen?: string, notes: Map<string, string> = new Map()) {
  const chess = new Chess(fen);
  const result = typeof tags?.Result === "string" ? tags.Result : "*";
  const headers = Object.entries(tags ?? {}).filter(([key, value]) => typeof value === "string" && key !== "messages" && key !== "FEN" && !(fen && key === "SetUp")).flatMap(([key, value]) => [key, value as string]);
  headers.push("Result", result);
  if (fen) headers.push("SetUp", "1", "FEN", fen);
  chess.header(...headers);
  for (const san of moves) {
    chess.move(san);
    const comment = notes.get(chess.fen());
    if (comment) chess.setComment(comment);
  }
  return chess.pgn({ maxWidth: 100 });
}
