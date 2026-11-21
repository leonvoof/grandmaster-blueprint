import { trainingMoveKey, type Exercise, type TrainingPosition } from "./opening-trainer.ts";
import { repertoirePositions, repertoireRoot, type PublicRepertoire } from "./public-repertoire.ts";

const nodeIds = new WeakMap<TrainingPosition, string>();

export function publicPracticeRoot(repertoire: PublicRepertoire): TrainingPosition {
  return publicPracticePosition(repertoire, repertoireRoot)!;
}

export function publicPracticePosition(repertoire: PublicRepertoire, nodeId: string): TrainingPosition | null {
  const positions = repertoirePositions(repertoire.moves);
  function build(id: string): TrainingPosition {
    const node = positions.get(id)!;
    const continuations = new Map();
    for (const childId of node.children) {
      const move = positions.get(childId)!.move!;
      continuations.set(trainingMoveKey(move), { move, position: build(childId) });
    }
    const position: TrainingPosition = { fen: node.fen, turn: node.ply % 2 === 0 ? "w" : "b", continuations };
    nodeIds.set(position, id);
    return position;
  }
  return positions.has(nodeId) ? build(nodeId) : null;
}

// Call on the accepted move's pre-move state, or immediately after Reveal.
export function publicPracticeOutcome(repertoireId: string, state: Exercise, decisionId: string, reviewedAt: number) {
  const nodeId = nodeIds.get(state.position);
  if (state.status !== "player" || !nodeId) return null;
  const incorrect = state.incorrectHere > 0;
  const hinted = state.hintsHere > 0;
  const revealed = state.revealsHere > 0;
  return { repertoireId, nodeId, decisionId, reviewedAt, firstCorrect: !incorrect && !hinted && !revealed, incorrect, hinted, revealed };
}
