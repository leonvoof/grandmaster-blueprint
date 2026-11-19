import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { withIsolatedDb } from "./isolated-db.mjs";
registerHooks({ resolve(specifier, context, nextResolve) { return specifier.startsWith("@/") ? nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context) : nextResolve(specifier, context); } });
const { parseOpeningPgn } = await import("../lib/opening-pgn.ts");
const { importOpeningPgn } = await import("../lib/opening-import.ts");
const { exportOpeningDocument } = await import("../lib/opening-export.ts");
const { lineMoves, canonicalLine } = await import("../lib/opening-tree.ts");
const pgn = `[Event "Nested prep"]\n[Opening "Test opening"]\n[Result "*"]\n\n1. e4 {center} (1. d4 $1 d5 (1... Nf6)) e5 2. Nf3 Nc6 *`;
const fenPgn = `[Event "Custom start"]\n[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]\n[Result "*"]\n\n1... e5 2. Nf3 *`;
test("parses nested RAV branches, comments, NAGs, multiple games, and custom FEN legally", () => {
 const games=parseOpeningPgn(`${pgn}\n\n${fenPgn}`);assert.equal(games.length,2);assert.deepEqual(games[0].lines.map(x=>lineMoves(x.pgn)).sort((a,b)=>a.join(" ").localeCompare(b.join(" "))),[["d4","d5"],["d4","Nf6"],["e4","e5","Nf3","Nc6"]].sort((a,b)=>a.join(" ").localeCompare(b.join(" "))));assert.ok(games[0].notes.some(n=>n.text==="center"));assert.equal(games[1].lines[0].pgn.includes('[FEN "rnbqkbnr'),true);for(const game of games)for(const line of game.lines)assert.doesNotThrow(()=>lineMoves(line.pgn));
});
test("rejects illegal or malformed PGN before persistence",()=>{assert.throws(()=>parseOpeningPgn('[Event "bad"]\n\n1. e4 e4 *'));assert.throws(()=>parseOpeningPgn('[broken'));});
test("imports atomically, preserves branches and notes, and skips repeated branch imports",()=>withIsolatedDb(async db=>{
 const repertoire=await db.openingRepertoire.create({data:{name:"R",side:"White"}});
 const first=await importOpeningPgn(repertoire.id,pgn,db);assert.equal(first.games,1);assert.equal(first.linesCreated,3);assert.equal(first.notesCreated,2);
 const chapter=await db.openingChapter.findFirst({where:{repertoireId:repertoire.id},include:{notes:true}});const lines=await db.openingLine.findMany({where:{chapterId:chapter.id}});assert.equal(lines.length,3);assert.ok(lines.some(x=>canonicalLine(x.pgn)==="d4 Nf6"));
 const exported=exportOpeningDocument([{lines,notes:chapter.notes}]);const roundtrip=parseOpeningPgn(exported);assert.equal(roundtrip.flatMap(game=>game.lines).length,3);assert.ok(roundtrip.flatMap(g=>g.notes).some(n=>n.text.includes("center")));assert.ok(roundtrip.flatMap(g=>g.notes).some(n=>n.text.includes("$1")));
 const repeated=await importOpeningPgn(repertoire.id,pgn,db);assert.equal(repeated.linesCreated,0);assert.equal(repeated.duplicates,3);assert.equal(await db.openingChapter.count({where:{repertoireId:repertoire.id}}),1);
 const custom=`[Opening "Test opening"]\n[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 5"]\n[Result "*"]\n\n5. e4 e5 6. Nf3 Nc6 *`;
 const customImport=await importOpeningPgn(repertoire.id,custom,db);assert.equal(customImport.linesCreated,1);assert.equal((await db.openingLine.count({where:{chapterId:chapter.id}})),4);
 await assert.rejects(importOpeningPgn(repertoire.id,`${pgn}\n\n[Event "bad"]\n\n1. e4 e4 *`,db));assert.equal(await db.openingChapter.count({where:{repertoireId:repertoire.id}}),1);assert.equal((await db.openingLine.count({where:{chapterId:chapter.id}})),4);assert.equal(await db.openingNote.count({where:{chapterId:chapter.id}}),2);
}));
