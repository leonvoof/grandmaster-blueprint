-- DropIndex

-- CreateTable
CREATE TABLE "OpeningRepertoire" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OpeningChapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repertoireId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'custom',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpeningChapter_repertoireId_fkey" FOREIGN KEY ("repertoireId") REFERENCES "OpeningRepertoire" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OpeningLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pgn" TEXT NOT NULL,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OpeningLine_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "OpeningChapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OpeningNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OpeningNote_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "OpeningChapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OpeningChapter_repertoireId_idx" ON "OpeningChapter"("repertoireId");

-- CreateIndex
CREATE INDEX "OpeningLine_chapterId_idx" ON "OpeningLine"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningNote_chapterId_fen_key" ON "OpeningNote"("chapterId", "fen");

