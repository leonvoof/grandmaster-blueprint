import { trainingMoveKey, type TrainingPosition } from "./opening-trainer.ts";
import { repertoirePositions, repertoireRoot, type PublicRepertoire } from "./public-repertoire.ts";

export function publicPracticeRoot(repertoire: PublicRepertoire): TrainingPosition {
  const positions = repertoirePositions(repertoire.moves);
  function build(id: string): TrainingPosition {
    const node = positions.get(id)!;
    const continuations = new Map();
    for (const childId of node.children) {
      const move = positions.get(childId)!.move!;
      continuations.set(trainingMoveKey(move), { move, position: build(childId) });
    }
    return { fen: node.fen, turn: node.ply % 2 === 0 ? "w" : "b", continuations };
  }
  return build(repertoireRoot);
}
