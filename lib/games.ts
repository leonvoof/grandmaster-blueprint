import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lichessSiteId, type parsePgnCollection } from "@/lib/pgn";

type ParsedGame = ReturnType<typeof parsePgnCollection>[number];
type LichessGame = ParsedGame & Pick<Prisma.ChessGameCreateInput, "lichessSpeed" | "lichessClock"> & {
  lichessId: string;
};

async function findExisting(tx: Prisma.TransactionClient, game: ParsedGame, lichessId?: string) {
  const exact = await tx.chessGame.findUnique({ where: { fingerprint: game.fingerprint } });
  if (exact || !lichessId) return exact;

  const byId = await tx.chessGame.findUnique({ where: { lichessId } });
  if (byId) return byId;

  // Existing manual exports can have different comments or clock tags.
  const candidates = await tx.chessGame.findMany({
    where: {
      lichessId: null,
      OR: [
        { pgn: { contains: `lichess.org/${lichessId}` } },
        { pgn: { contains: `lichess.org/game/${lichessId}` } },
      ],
    },
  });
  return candidates.find((candidate) => lichessSiteId(candidate.pgn) === lichessId);
}

export async function savePgnGames(games: ParsedGame[]) {
  return prisma.$transaction(async (tx) => {
    for (const game of games) {
      const lichessId = lichessSiteId(game.pgn);
      if (!await findExisting(tx, game, lichessId)) {
        await tx.chessGame.create({ data: { ...game, lichessId } });
      }
    }
  });
}

export async function saveLichessGame(game: LichessGame, db: PrismaClient = prisma) {
  return db.$transaction(async (tx) => {
    if (await findExisting(tx, game, game.lichessId)) return false;
    await tx.chessGame.create({ data: game });
    return true;
  });
}

export async function listSavedGames(db: PrismaClient = prisma) {
  return db.chessGame.findMany({ orderBy: { createdAt: "desc" } });
}
