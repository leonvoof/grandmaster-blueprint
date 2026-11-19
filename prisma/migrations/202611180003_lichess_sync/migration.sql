ALTER TABLE "ChessGame" ADD COLUMN "lichessId" TEXT;
ALTER TABLE "ChessGame" ADD COLUMN "lichessSpeed" TEXT;
ALTER TABLE "ChessGame" ADD COLUMN "lichessClock" JSONB;
CREATE UNIQUE INDEX "ChessGame_lichessId_key" ON "ChessGame"("lichessId");

CREATE TABLE "LichessSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'local-player',
    "username" TEXT NOT NULL,
    "classical" INTEGER,
    "rapid" INTEGER,
    "blitz" INTEGER
);
