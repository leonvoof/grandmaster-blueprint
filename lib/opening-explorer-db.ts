import type { PrismaClient } from "@prisma/client";
import { buildPersonalExplorerStats, buildRepertoireContinuations, type ExplorerGame, type RepertoireLine } from "./opening-explorer.ts";

export async function loadPersonalExplorerData(db: PrismaClient, fen: string, filters: { since?: string; until?: string; speed?: string } = {}) {
  const games = await db.chessGame.findMany({ select: { id: true, pgn: true, opening: true, result: true, fingerprint: true, date: true, lichessSpeed: true } });
  const since = filters.since ? (filters.since.length === 4 ? `${filters.since}-01` : filters.since) : "";
  const until = filters.until ? (filters.until.length === 4 ? `${filters.until}-12` : filters.until) : "";
  const selectedGames = games.filter((game) => {
    if (filters.speed && game.lichessSpeed !== filters.speed) return false;
    if (!since && !until) return true;
    const date = game.date?.replaceAll(".", "-");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const month = date.slice(0, 7);
    return (!since || month >= since) && (!until || month <= until);
  });
  const data = buildPersonalExplorerStats(fen, selectedGames as ExplorerGame[]);
  return { ...data, repertoireMoves: await loadRepertoireExplorerMoves(db, fen), gameRecordsExamined: selectedGames.length };
}

export async function loadRepertoireExplorerMoves(db: PrismaClient, fen: string) {
  const repertoires = await db.openingRepertoire.findMany({ include: { chapters: { include: { lines: true } } } });
  const lines: RepertoireLine[] = repertoires.flatMap((repertoire) => repertoire.chapters.flatMap((chapter) => chapter.lines.map((line) => ({
    pgn: line.pgn, repertoireId: repertoire.id, chapterId: chapter.id,
    repertoireName: repertoire.name, chapterName: chapter.name, lineName: line.name,
  }))));
  return buildRepertoireContinuations(fen, lines);
}
