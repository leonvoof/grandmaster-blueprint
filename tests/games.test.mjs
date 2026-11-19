import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withIsolatedDb } from './isolated-db.mjs';
import { parsePgnCollection, positionAfter } from '../lib/pgn.ts';

const pgn='[Event "Persistence Test"]\n[Site "Local"]\n[Date "2026.01.01"]\n[Round "1"]\n[White "Test White"]\n[Black "Test Black"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0';
test('parses PGN and navigates legal positions',()=>{
 const [g]=parsePgnCollection(pgn); assert.equal(g.white,'Test White'); assert.equal(g.result,'1-0');
 const start=positionAfter(['e4','e5','Nf3'],0), after=positionAfter(['e4','e5','Nf3'],3);
 assert.notEqual(start,after); assert.equal(positionAfter(['e4','e5','Nf3'],2),positionAfter(['e4','e5'],2));
});
test('saves, lists, reopens, and deduplicates a PGN game', () => withIsolatedDb(async (db) => {
 const [game] = parsePgnCollection(pgn);
 const where = { fingerprint: game.fingerprint };
 const first = await db.chessGame.upsert({ where, create: game, update: {} });
 await db.chessGame.upsert({ where, create: game, update: {} });
 const rows = await db.chessGame.findMany({ where });
 assert.equal(rows.length, 1);
 const reopened = await db.chessGame.findUnique({ where: { id: first.id } });
 assert.equal(reopened.pgn, game.pgn);
 assert.equal(reopened.white, game.white);
}));
