import { Chess, type Square } from "chess.js";

export type LegalMoveTarget = { square: Square; capture: boolean };

export function legalMoveTargets(fen: string, from: Square): LegalMoveTarget[] {
  try {
    const chess = new Chess(fen);
    if (chess.get(from)?.color !== chess.turn()) return [];
    const targets = new Map<Square, boolean>();
    for (const move of chess.moves({ square: from, verbose: true })) {
      targets.set(move.to, Boolean(move.captured) || targets.get(move.to) === true);
    }
    return [...targets].map(([square, capture]) => ({ square, capture }));
  } catch {
    return [];
  }
}

export function legalMoveSquareStyles(fen: string, from: Square): Partial<Record<Square, Record<string, string | number>>> {
  return Object.fromEntries(legalMoveTargets(fen, from).map(({ square, capture }) => [square, capture
    ? { borderRadius: "50%", boxShadow: "inset 0 0 0 4px rgba(16, 48, 36, 0.58)" }
    : { backgroundImage: "radial-gradient(circle, rgba(16, 48, 36, 0.54) 19%, transparent 22%)", backgroundPosition: "center", backgroundRepeat: "no-repeat", backgroundSize: "100% 100%" },
  ]));
}

export function boardAnimationDuration(reducedMotion: boolean) {
  return reducedMotion ? 0 : 220;
}
