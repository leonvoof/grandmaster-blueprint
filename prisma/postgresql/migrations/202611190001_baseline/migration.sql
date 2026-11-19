-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "id" TEXT NOT NULL DEFAULT 'local-player',
    "displayName" TEXT NOT NULL,
    "currentRating" INTEGER NOT NULL DEFAULT 1800,
    "ratingPlatform" TEXT NOT NULL DEFAULT 'Lichess Classical',
    "targetTitle" TEXT NOT NULL DEFAULT 'Candidate Master',
    "targetRating" INTEGER NOT NULL DEFAULT 2200,
    "weeklyStudyHours" INTEGER NOT NULL DEFAULT 10,
    "preferredSide" TEXT NOT NULL DEFAULT 'Both',
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChessGame" (
    "id" TEXT NOT NULL,
    "white" TEXT NOT NULL,
    "black" TEXT NOT NULL,
    "date" TEXT,
    "result" TEXT,
    "opening" TEXT,
    "pgn" TEXT NOT NULL,
    "initialFen" TEXT,
    "fingerprint" TEXT,
    "lichessId" TEXT,
    "lichessSpeed" TEXT,
    "lichessClock" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChessGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameAnalysis" (
    "id" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "gameAnalysisId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "submittedSan" TEXT,
    "matchedBest" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MistakeReflection" (
    "id" TEXT NOT NULL,
    "gameAnalysisId" TEXT NOT NULL,
    "thinking" TEXT NOT NULL DEFAULT '',
    "overlooked" TEXT NOT NULL DEFAULT '',
    "variations" TEXT NOT NULL DEFAULT '',
    "learned" TEXT NOT NULL DEFAULT '',
    "recognition" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MistakeReflection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TacticsPuzzle" (
    "id" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "themes" TEXT NOT NULL,
    "moveCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TacticsPuzzle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TacticsAttempt" (
    "id" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "submittedMoves" TEXT NOT NULL,
    "firstAttemptCorrect" BOOLEAN NOT NULL,
    "solvingTimeMs" INTEGER NOT NULL,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "solutionRevealed" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TacticsAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LichessSettings" (
    "id" TEXT NOT NULL DEFAULT 'local-player',
    "username" TEXT NOT NULL,
    "classical" INTEGER,
    "rapid" INTEGER,
    "blitz" INTEGER,

    CONSTRAINT "LichessSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningRepertoire" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningRepertoire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningChapter" (
    "id" TEXT NOT NULL,
    "repertoireId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'custom',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningLine" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pgn" TEXT NOT NULL,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningNote" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningTrainingPosition" (
    "id" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "repertoireId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "trainingColor" TEXT NOT NULL,
    "startingFen" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "contextPath" TEXT NOT NULL,
    "expectedMoves" TEXT NOT NULL,
    "applicable" BOOLEAN NOT NULL DEFAULT true,
    "lastReviewAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "intervalDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repetition" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "recentSuccessHistory" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningTrainingPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningTrainingReview" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "submittedMove" TEXT,
    "firstAttemptCorrect" BOOLEAN NOT NULL,
    "incorrectAttempts" INTEGER NOT NULL DEFAULT 0,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "answersRevealed" INTEGER NOT NULL DEFAULT 0,
    "grade" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningTrainingReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChessGame_fingerprint_key" ON "ChessGame"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ChessGame_lichessId_key" ON "ChessGame"("lichessId");

-- CreateIndex
CREATE INDEX "GameAnalysis_gameId_idx" ON "GameAnalysis"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "GameAnalysis_gameId_fen_engine_settings_depth_key" ON "GameAnalysis"("gameId", "fen", "engine", "settings", "depth");

-- CreateIndex
CREATE INDEX "ReviewEvent_gameAnalysisId_createdAt_idx" ON "ReviewEvent"("gameAnalysisId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MistakeReflection_gameAnalysisId_key" ON "MistakeReflection"("gameAnalysisId");

-- CreateIndex
CREATE INDEX "TacticsPuzzle_rating_idx" ON "TacticsPuzzle"("rating");

-- CreateIndex
CREATE UNIQUE INDEX "TacticsAttempt_idempotencyKey_key" ON "TacticsAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TacticsAttempt_puzzleId_createdAt_idx" ON "TacticsAttempt"("puzzleId", "createdAt");

-- CreateIndex
CREATE INDEX "OpeningChapter_repertoireId_idx" ON "OpeningChapter"("repertoireId");

-- CreateIndex
CREATE INDEX "OpeningLine_chapterId_idx" ON "OpeningLine"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningNote_chapterId_fen_key" ON "OpeningNote"("chapterId", "fen");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningTrainingPosition_identity_key" ON "OpeningTrainingPosition"("identity");

-- CreateIndex
CREATE INDEX "opening_training_position_applicable_idx" ON "OpeningTrainingPosition"("repertoireId", "chapterId", "trainingColor", "applicable");

-- CreateIndex
CREATE INDEX "opening_training_position_due_idx" ON "OpeningTrainingPosition"("repertoireId", "chapterId", "trainingColor", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningTrainingReview_idempotencyKey_key" ON "OpeningTrainingReview"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OpeningTrainingReview_positionId_reviewedAt_idx" ON "OpeningTrainingReview"("positionId", "reviewedAt");

-- AddForeignKey
ALTER TABLE "GameAnalysis" ADD CONSTRAINT "GameAnalysis_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "ChessGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_gameAnalysisId_fkey" FOREIGN KEY ("gameAnalysisId") REFERENCES "GameAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MistakeReflection" ADD CONSTRAINT "MistakeReflection_gameAnalysisId_fkey" FOREIGN KEY ("gameAnalysisId") REFERENCES "GameAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TacticsAttempt" ADD CONSTRAINT "TacticsAttempt_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "TacticsPuzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningChapter" ADD CONSTRAINT "OpeningChapter_repertoireId_fkey" FOREIGN KEY ("repertoireId") REFERENCES "OpeningRepertoire"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningLine" ADD CONSTRAINT "OpeningLine_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "OpeningChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningNote" ADD CONSTRAINT "OpeningNote_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "OpeningChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningTrainingReview" ADD CONSTRAINT "OpeningTrainingReview_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OpeningTrainingPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
