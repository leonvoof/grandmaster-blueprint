import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { lineIdentity } from "@/lib/opening-tree";
import { parseOpeningPgn } from "@/lib/opening-pgn";

export async function importOpeningPgn(repertoireId: string, pgn: string, db: PrismaClient = prisma) {
  const games = parseOpeningPgn(pgn);
  return db.$transaction(async (tx) => {
    if (!await tx.openingRepertoire.findUnique({ where: { id: repertoireId } })) throw new Error("Repertoire not found.");
    let chapters = 0, linesCreated = 0, duplicates = 0, notesCreated = 0;
    for (const game of games) {
      let chapter = await tx.openingChapter.findFirst({ where: { repertoireId, name: game.name } });
      if (!chapter) { chapter = await tx.openingChapter.create({ data: { repertoireId, name: game.name, category: "custom" } }); chapters++; }
      const existing = await tx.openingLine.findMany({ where: { chapterId: chapter.id }, select: { pgn: true } });
      const branchKeys = new Set(existing.map(({ pgn: saved }) => lineIdentity(saved)));
      for (const line of game.lines) {
        const key = lineIdentity(line.pgn);
        if (branchKeys.has(key)) { duplicates++; continue; }
        await tx.openingLine.create({ data: { chapterId: chapter.id, name: line.name, pgn: line.pgn } });
        branchKeys.add(key); linesCreated++;
      }
      for (const note of game.notes) {
        const prior = await tx.openingNote.findUnique({ where: { chapterId_fen: { chapterId: chapter.id, fen: note.fen } } });
        if (!prior) { await tx.openingNote.create({ data: { chapterId: chapter.id, ...note } }); notesCreated++; }
      }
    }
    return { games: games.length, chapters, linesCreated, duplicates, notesCreated };
  });
}
