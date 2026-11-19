import { Chess, type Color, type Move } from "chess.js";

export type TrainingLine = { pgn: string };
type SavedMove = Pick<Move, "from" | "to" | "promotion" | "san">;
export type TrainingPosition = {
  fen: string;
  turn: Color;
  continuations: ReadonlyMap<string, { move: SavedMove; position: TrainingPosition }>;
};
type BuildingPosition = Omit<TrainingPosition, "continuations"> & {
  continuations: Map<string, { move: SavedMove; position: BuildingPosition }>;
};
type Stats = {
  attempted: number;
  firstCorrect: number;
  incorrect: number;
  hints: number;
  reveals: number;
  completed: number;
};

export const emptyStats: Readonly<Stats> = {
  attempted: 0, firstCorrect: 0, incorrect: 0, hints: 0, reveals: 0, completed: 0,
};

export type Exercise = {
  root: TrainingPosition;
  position: TrainingPosition;
  color: Color;
  moves: readonly string[];
  status: "starting" | "player" | "opponent" | "complete" | "ended";
  attemptedHere: boolean;
  incorrectHere: number;
  hintsHere: number;
  revealsHere: number;
  lastSubmitted: string | null;
  hint: string;
  revealed: string;
  feedback: string;
  stats: Readonly<Stats>;
};

const moveKey = (move: SavedMove) => move.from + move.to + (move.promotion ?? "");
const pick = <T,>(items: readonly T[], random: () => number) => items[Math.floor(random() * items.length)];

export function buildTrainingTree(lines: readonly TrainingLine[]) {
  const roots = new Map<string, BuildingPosition>();
  let skipped = 0;
  for (const line of lines) {
    let moves: Move[];
    try {
      const chess = new Chess();
      chess.loadPgn(line.pgn);
      moves = chess.history({ verbose: true });
    } catch {
      skipped++;
      continue;
    }
    if (moves.length === 0) continue;
    const first = moves[0];
    const root = roots.get(first.before) ?? {
      fen: first.before, turn: first.color, continuations: new Map(),
    };
    roots.set(root.fen, root);
    let position = root;
    for (const move of moves) {
      const key = moveKey(move);
      let edge = position.continuations.get(key);
      if (!edge) {
        edge = {
          move,
          position: { fen: move.after, turn: move.color === "w" ? "b" : "w", continuations: new Map() },
        };
        position.continuations.set(key, edge);
      }
      position = edge.position;
    }
  }
  return { roots: [...roots.values()] as readonly TrainingPosition[], skipped };
}

function settle(state: Exercise): Exercise {
  const { position, color, stats } = state;
  if (position.continuations.size === 0) {
    return { ...state, status: "complete", stats: { ...stats, completed: stats.completed + 1 } };
  }
  return { ...state, status: position.turn === color ? "player" : "opponent" };
}

function follow(state: Exercise, move: Move): Exercise {
  const edge = state.position.continuations.get(moveKey(move));
  if (!edge || edge.position.fen !== move.after) throw new Error("Saved continuation does not match the current position.");
  return settle({
    ...state, position: edge.position, moves: [...state.moves, move.san],
    attemptedHere: false, incorrectHere: 0, hintsHere: 0, revealsHere: 0,
    lastSubmitted: null, hint: "", revealed: "",
  });
}

export function playOpponent(state: Exercise, random: () => number): Exercise {
  if (state.status !== "opponent") return state;
  const { move } = pick([...state.position.continuations.values()], random);
  const played = new Chess(state.position.fen).move(move);
  return follow({ ...state, feedback: [state.feedback, `Opponent played ${played.san}.`].filter(Boolean).join(" ") }, played);
}

export function startExercise(root: TrainingPosition, color: Color, random: () => number, stats = emptyStats): Exercise {
  const initial: Exercise = {
    root, position: root, color, moves: [], status: "starting", stats,
    attemptedHere: false, incorrectHere: 0, hintsHere: 0, revealsHere: 0, lastSubmitted: null,
    hint: "", revealed: "", feedback: "",
  };
  return playOpponent(settle(initial), random);
}

export function startExerciseAt(root: TrainingPosition, position: TrainingPosition, color: Color, random: () => number, contextPath: readonly string[], stats = emptyStats): Exercise {
  const initial: Exercise = {
    root, position, color, moves: [...contextPath], status: "starting", stats,
    attemptedHere: false, incorrectHere: 0, hintsHere: 0, revealsHere: 0, lastSubmitted: null,
    hint: "", revealed: "", feedback: "",
  };
  return playOpponent(settle(initial), random);
}

export function selectRoot(roots: readonly TrainingPosition[], random: () => number, previous?: TrainingPosition) {
  const alternatives = roots.filter((root) => root !== previous);
  return pick(alternatives.length ? alternatives : roots, random);
}

export function trainingPositionAt(root: TrainingPosition, contextPath: readonly string[], fen: string): TrainingPosition | null {
  let position = root;
  for (const san of contextPath) {
    const edge = [...position.continuations.values()].find((candidate) => candidate.move.san === san);
    if (!edge) return null;
    position = edge.position;
  }
  return position.fen === fen ? position : null;
}

export function playAnswer(state: Exercise, input: { from: string; to: string; promotion?: string }, random: () => number) {
  if (state.status !== "player") return { state, accepted: false };
  let move: Move;
  try {
    move = new Chess(state.position.fen).move(input);
  } catch {
    return { state: { ...state, feedback: "That move is illegal in this position." }, accepted: false };
  }
  const stats = { ...state.stats, attempted: state.stats.attempted + Number(!state.attemptedHere) };
  if (!state.position.continuations.has(moveKey(move))) {
    return {
      state: { ...state, stats: { ...stats, incorrect: stats.incorrect + 1 }, attemptedHere: true, incorrectHere: state.incorrectHere + 1, lastSubmitted: moveKey(move), feedback: `${move.san} is legal but outside the saved repertoire.` },
      accepted: false,
    };
  }
  if (!state.attemptedHere && !state.hint && !state.revealed) stats.firstCorrect++;
  const next = follow({ ...state, stats, lastSubmitted: moveKey(move), feedback: "Correct repertoire move." }, move);
  return { state: playOpponent(next, random), accepted: true };
}

export function requestHint(state: Exercise): Exercise {
  if (state.status !== "player" || state.hint || state.revealed) return state;
  const edge = state.position.continuations.values().next().value!;
  const piece = new Chess(state.position.fen).get(edge.move.from)!.type;
  const names = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  return { ...state, hint: `One saved move uses a ${names[piece]}.`, hintsHere: state.hintsHere + 1, stats: { ...state.stats, hints: state.stats.hints + 1 } };
}

export function revealAnswer(state: Exercise): Exercise {
  if (state.status !== "player" || state.revealed) return state;
  const edge = state.position.continuations.values().next().value!;
  return { ...state, revealed: edge.move.san, revealsHere: state.revealsHere + 1, stats: { ...state.stats, reveals: state.stats.reveals + 1 } };
}

export function endExercise(state: Exercise): Exercise {
  return state.status === "ended" ? state : { ...state, status: "ended", hint: "", revealed: "" };
}
