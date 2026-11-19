CREATE TABLE "ReviewEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "gameAnalysisId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "submittedSan" TEXT,
  "matchedBest" BOOLEAN,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewEvent_gameAnalysisId_fkey" FOREIGN KEY ("gameAnalysisId") REFERENCES "GameAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReviewEvent_gameAnalysisId_createdAt_idx" ON "ReviewEvent"("gameAnalysisId", "createdAt");
CREATE TABLE "MistakeReflection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "gameAnalysisId" TEXT NOT NULL,
  "thinking" TEXT NOT NULL DEFAULT '',
  "overlooked" TEXT NOT NULL DEFAULT '',
  "variations" TEXT NOT NULL DEFAULT '',
  "learned" TEXT NOT NULL DEFAULT '',
  "recognition" TEXT NOT NULL DEFAULT '',
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MistakeReflection_gameAnalysisId_fkey" FOREIGN KEY ("gameAnalysisId") REFERENCES "GameAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MistakeReflection_gameAnalysisId_key" ON "MistakeReflection"("gameAnalysisId");
