import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_DEPTH, ENGINE_BUILD, ENGINE_SETTINGS } from "@/lib/stockfish/engine";
import { aggregateWeaknesses, type TimeControl } from "@/lib/weakness-analysis";

export async function getWeaknessReport(
  { player, timeControl = "classical", depth = DEFAULT_DEPTH }: { player?: string; timeControl?: TimeControl; depth?: number } = {},
  db: PrismaClient = prisma,
) {
  const username = player ?? (await db.lichessSettings.findUnique({
    where: { id: "local-player" },
    select: { username: true },
  }))?.username ?? "";
  const cohort = { engine: ENGINE_BUILD, settings: ENGINE_SETTINGS, depth };
  const games = username ? await db.chessGame.findMany({
    where: timeControl === "all" ? undefined : { lichessSpeed: timeControl },
    select: {
      id: true, pgn: true, white: true, black: true, opening: true,
      lichessId: true, lichessSpeed: true, lichessClock: true,
      analyses: {
        where: cohort,
        select: { id: true, ply: true, fen: true, engine: true, settings: true, depth: true, scoreType: true, scoreValue: true },
      },
    },
  }) : [];
  return aggregateWeaknesses(games, { player: username, timeControl, cohort });
}
