ALTER TABLE "ChessGame" ADD COLUMN "initialFen" TEXT;
ALTER TABLE "ChessGame" ADD COLUMN "fingerprint" TEXT;
CREATE UNIQUE INDEX "ChessGame_fingerprint_key" ON "ChessGame"("fingerprint");
