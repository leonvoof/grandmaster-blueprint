CREATE TABLE "OpeningTrainingPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identity" TEXT NOT NULL,
    "repertoireId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "trainingColor" TEXT NOT NULL,
    "startingFen" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "contextPath" TEXT NOT NULL,
    "expectedMoves" TEXT NOT NULL,
    "applicable" BOOLEAN NOT NULL DEFAULT true,
    "lastReviewAt" DATETIME,
    "nextReviewAt" DATETIME,
    "intervalDays" REAL NOT NULL DEFAULT 0,
    "repetition" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "recentSuccessHistory" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "OpeningTrainingPosition_identity_key" ON "OpeningTrainingPosition"("identity");
CREATE INDEX "OpeningTrainingPosition_repertoireId_chapterId_trainingColor_applicable_idx" ON "OpeningTrainingPosition"("repertoireId", "chapterId", "trainingColor", "applicable");
CREATE INDEX "OpeningTrainingPosition_repertoireId_chapterId_trainingColor_nextReviewAt_idx" ON "OpeningTrainingPosition"("repertoireId", "chapterId", "trainingColor", "nextReviewAt");

CREATE TABLE "OpeningTrainingReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "positionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "submittedMove" TEXT,
    "firstAttemptCorrect" BOOLEAN NOT NULL,
    "incorrectAttempts" INTEGER NOT NULL DEFAULT 0,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "answersRevealed" INTEGER NOT NULL DEFAULT 0,
    "grade" INTEGER NOT NULL,
    "reviewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpeningTrainingReview_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OpeningTrainingPosition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OpeningTrainingReview_idempotencyKey_key" ON "OpeningTrainingReview"("idempotencyKey");
CREATE INDEX "OpeningTrainingReview_positionId_reviewedAt_idx" ON "OpeningTrainingReview"("positionId", "reviewedAt");
