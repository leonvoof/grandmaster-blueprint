CREATE TABLE "GameAnalysis" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "gameId" TEXT NOT NULL,
  "fen" TEXT NOT NULL,
  "ply" INTEGER NOT NULL,
  "engine" TEXT NOT NULL,
  "settings" TEXT NOT NULL,
  "depth" INTEGER NOT NULL,
  "scoreType" TEXT,
  "scoreValue" INTEGER,
  "bestMove" TEXT,
  "variation" TEXT NOT NULL,
  "terminal" TEXT,
  "note" TEXT,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "GameAnalysis_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "ChessGame"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GameAnalysis_gameId_fen_engine_settings_depth_key" ON "GameAnalysis"("gameId", "fen", "engine", "settings", "depth");
CREATE INDEX "GameAnalysis_gameId_idx" ON "GameAnalysis"("gameId");
