import { Chess } from "chess.js";

export function loadGameReplay(pgn: string) {
  const game = new Chess();
  game.loadPgn(pgn);
  const moves = game.history({ verbose: true });
  return {
    game,
    initialFen: moves[0]?.before ?? game.fen(),
    moves: moves.map(({ san, after, from, to, promotion }) => ({ san, fen: after, from, to, promotion: promotion ?? null })),
    headers: game.getHeaders(),
  };
}
