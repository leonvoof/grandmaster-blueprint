CREATE TABLE "PlayerProfile" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local-player',
  "displayName" TEXT NOT NULL,
  "currentRating" INTEGER NOT NULL DEFAULT 1800,
  "ratingPlatform" TEXT NOT NULL DEFAULT 'Lichess Classical',
  "targetTitle" TEXT NOT NULL DEFAULT 'Candidate Master',
  "targetRating" INTEGER NOT NULL DEFAULT 2200,
  "weeklyStudyHours" INTEGER NOT NULL DEFAULT 10,
  "preferredSide" TEXT NOT NULL DEFAULT 'Both',
  "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "ChessGame" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "white" TEXT NOT NULL,
  "black" TEXT NOT NULL,
  "date" TEXT,
  "result" TEXT,
  "opening" TEXT,
  "pgn" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
