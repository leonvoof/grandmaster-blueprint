import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { withIsolatedDb } from "./isolated-db.mjs";
import { parsePuzzleRow, selectPuzzleQuery } from "../lib/tactics.ts";
const row = (id, moves, rating=1500, themes="fork middlegame") => ({id, fen:"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", moves, rating, themes});
test("puzzle importer applies the setup move and validates complete solution sequences",()=>{
 const p=parsePuzzleRow(row("p1","e2e4 e7e5 g1f3")); assert.equal(p.fen,"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"); assert.deepEqual(JSON.parse(p.solution),["e7e5","g1f3"]); assert.equal(p.moveCount,1); assert.equal(p.license,"CC0 1.0 Universal (Public Domain)");
 assert.throws(()=>parsePuzzleRow(row("bad","e2e5 e7e5")));
});
test("special solutions validate promotion and checkmate moves",()=>{
 const promotion=parsePuzzleRow({...row("promo","h8g8 a7a8q"),fen:"7k/P7/8/8/8/8/8/7K b - - 0 1"}); assert.equal(JSON.parse(promotion.solution)[0],"a7a8q");
 const mate=parsePuzzleRow({...row("mate","h8g8 h1g2"),fen:"7k/8/8/8/8/8/8/7K b - - 0 1"}); assert.ok(mate.fen);
});
test("theme and rating filters build database predicates",()=>{
 const where=selectPuzzleQuery({minRating:1200,maxRating:1800,theme:"fork",failed:true}); assert.deepEqual(where.rating,{gte:1200,lte:1800}); assert.deepEqual(where.attempts,{some:{firstAttemptCorrect:false}}); assert.match(where.themes.contains,/fork/);
 assert.deepEqual(selectPuzzleQuery({unattempted:true}).attempts,{none:{}});
});
test("puzzles deduplicate and attempts persist with idempotency",()=>withIsolatedDb(async(db,file)=>{
 const parsed=parsePuzzleRow(row("db1","e2e4 e7e5 g1f3")); await db.tacticsPuzzle.upsert({where:{id:parsed.id},create:parsed,update:{}}); await db.tacticsPuzzle.upsert({where:{id:parsed.id},create:parsed,update:{}}); assert.equal(await db.tacticsPuzzle.count(),1);
 await db.tacticsAttempt.create({data:{puzzleId:parsed.id,idempotencyKey:"attempt-1",submittedMoves:JSON.stringify(["e7e5","g1f3"]),firstAttemptCorrect:true,solvingTimeMs:12000,completed:true}}); await assert.rejects(db.tacticsAttempt.create({data:{puzzleId:parsed.id,idempotencyKey:"attempt-1",submittedMoves:"[]",firstAttemptCorrect:false,solvingTimeMs:1,completed:false}})); await db.$disconnect();
 const reopened=new PrismaClient({datasourceUrl:`file:${file}`}); assert.equal(await reopened.tacticsAttempt.count(),1); await reopened.$disconnect();
}));
