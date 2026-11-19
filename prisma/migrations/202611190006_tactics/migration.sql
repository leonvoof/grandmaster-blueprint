CREATE TABLE "TacticsPuzzle" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fen" TEXT NOT NULL,
  "solution" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "themes" TEXT NOT NULL,
  "moveCount" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "license" TEXT NOT NULL,
  "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TacticsPuzzle_rating_idx" ON "TacticsPuzzle"("rating");
CREATE TABLE "TacticsAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "puzzleId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "submittedMoves" TEXT NOT NULL,
  "firstAttemptCorrect" BOOLEAN NOT NULL,
  "solvingTimeMs" INTEGER NOT NULL,
  "hintsUsed" INTEGER NOT NULL DEFAULT 0,
  "solutionRevealed" BOOLEAN NOT NULL DEFAULT false,
  "completed" BOOLEAN NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TacticsAttempt_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "TacticsPuzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TacticsAttempt_idempotencyKey_key" ON "TacticsAttempt"("idempotencyKey");
CREATE INDEX "TacticsAttempt_puzzleId_createdAt_idx" ON "TacticsAttempt"("puzzleId", "createdAt");
