import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
registerHooks({resolve(s,c,n){return s.startsWith("@/")?n(new URL(`../${s.slice(2)}.ts`,import.meta.url).href,c):n(s,c)}});
const {findCriticalMoves,classifyLoss,evaluationValue}=await import("../lib/evaluation-review.ts");
const analysis=(value,depth=12,kind="cp")=>({engine:"sf19",settings:"s",depth,score:{kind,value},bestMove:"Nf3",variation:["Nf3","Nc6"]});
test("handles White/Black perspectives, mates, gaps, thresholds, and before-move alternatives",()=>{
 const points=[{ply:0,san:null,analysis:analysis(100),evaluation:1,mate:null},{ply:1,san:"e4",analysis:analysis(-20),evaluation:-.2,mate:null},{ply:2,san:"e5",analysis:analysis(180),evaluation:1.8,mate:null},{ply:3,san:"Nf3",analysis:null,evaluation:null,mate:null},{ply:4,san:"Nc6",analysis:analysis(2,12,"mate"),evaluation:null,mate:2}];
 const mistakes=findCriticalMoves(points,{inaccuracy:50,mistake:100,blunder:200});
 assert.equal(mistakes[0].loss,1.2); assert.equal(mistakes[0].classification,"Mistake"); assert.equal(mistakes[0].alternative,"Nf3"); assert.deepEqual(mistakes[0].variation,["Nf3","Nc6"]);
 assert.equal(mistakes[1].loss,2); assert.equal(mistakes[1].classification,"Blunder");
 assert.equal(classifyLoss(200,{inaccuracy:50,mistake:100,blunder:200}),"Blunder");
 assert.deepEqual(evaluationValue(analysis(-3,12,"mate")),{evaluation:null,mate:-3});
 assert.equal(findCriticalMoves([points[0],{...points[1],analysis:analysis(-20,10)}],{inaccuracy:50,mistake:100,blunder:200}).length,0);
 assert.equal(findCriticalMoves([points[0],points[3]],{inaccuracy:50,mistake:100,blunder:200}).length,0);
 assert.equal(findCriticalMoves([{...points[0],settings:"threads=1"},{...points[1],settings:"threads=2"}],{inaccuracy:50,mistake:100,blunder:200}).length,0);
});

test("uses the starting FEN to classify a Black first move and keep PGN numbering", () => {
 const start = { ply: 0, san: null, analysis: analysis(-100), fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 7" };
 const after = { ply: 1, san: "e5", analysis: analysis(120) };
 const [move] = findCriticalMoves([start, after], { inaccuracy: 50, mistake: 100, blunder: 200 });
 assert.equal(move.color, "black");
 assert.equal(move.moveNumber, 7);
 assert.equal(move.san, "e5");
 assert.equal(move.classification, "Blunder");
});
