"use client";

import { useEffect, useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useBoardAnimationDuration } from "@/components/use-board-animation-duration";
import { legalMoveSquareStyles } from "@/lib/board-interaction";

export type BoardMove = { from: Square; to: Square; promotion?: string };

export function PublicBoard({ fen, move, black = false, green = false, disabled = false, id, arrow, clickPromotion = false }: { fen: string; move: (move: BoardMove) => boolean; black?: boolean; green?: boolean; disabled?: boolean; id?: string; arrow?: [Square, Square] | null; clickPromotion?: boolean }) {
  const [selection, setSelection] = useState<{ fen: string; square: Square } | null>(null);
  const [promotionChoice, setPromotionChoice] = useState<{ fen: string; from: Square; to: Square } | null>(null);
  const promotion = promotionChoice?.fen === fen ? promotionChoice : null;
  const selected = !disabled && selection?.fen === fen ? selection.square : null;
  const animationDuration = useBoardAnimationDuration();
  useEffect(() => { setSelection(null); setPromotionChoice(null); }, [fen]);
  function click(square: Square) {
    const position = new Chess(fen);
    if (promotion) return;
    if (position.get(square)?.color === position.turn()) {
      setSelection(selected === square ? null : { fen, square });
      return;
    }
    if (!selected) return;
    const promotes = position.moves({ square: selected, verbose: true }).some((candidate) => candidate.to === square && candidate.promotion);
    if (!promotes) move({ from: selected, to: square });
    else if (clickPromotion) setPromotionChoice({ fen, from: selected, to: square });
    setSelection(null);
  }
  const arrows = useMemo<[Square, Square, string?][] | undefined>(() => arrow === undefined ? undefined : arrow ? [[...arrow, "#0c8b71"]] : [], [arrow]);
  const moveStyles = selected ? legalMoveSquareStyles(fen, selected) : {};
  const squareStyles = { ...moveStyles, ...(selected ? { [selected]: { backgroundColor: "rgba(80, 200, 170, 0.55)", boxShadow: "inset 0 0 0 3px rgba(229, 255, 246, 0.75)" } } : {}) };
  return <div className="mx-auto w-full max-w-[560px]">
    <Chessboard id={id} position={fen} boardOrientation={black ? "black" : "white"} animationDuration={animationDuration}
      onSquareClick={disabled ? undefined : click}
      arePiecesDraggable={!disabled && !promotion}
      customArrows={arrows}
      customSquareStyles={squareStyles}
      customDarkSquareStyle={green ? { backgroundColor: "#42665e" } : undefined}
      customLightSquareStyle={green ? { backgroundColor: "#d8e5dc" } : undefined}
      onPieceDrop={(from, to) => { setSelection(null); return !disabled && move({ from, to }); }}
      onPromotionCheck={(from, to) => new Chess(fen).moves({ square: from, verbose: true }).some((candidate) => candidate.to === to && candidate.promotion)}
      onPromotionPieceSelect={(piece, from, to) => Boolean(!disabled && piece && from && to && move({ from, to, promotion: piece[1].toLowerCase() }))} />
    {promotion && <div role="dialog" aria-label="Choose promotion piece" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-white/15 bg-[#111815] p-2">
      <span className="text-xs">Promote to</span>
      {([["q", "Queen"], ["r", "Rook"], ["b", "Bishop"], ["n", "Knight"]] as const).map(([piece, name]) => <button key={piece} autoFocus={piece === "q"} className="btn" onClick={() => {
        move({ from: promotion.from, to: promotion.to, promotion: piece });
        setPromotionChoice(null);
      }}>{name}</button>)}
      <button className="btn" onClick={() => setPromotionChoice(null)}>Cancel</button>
    </div>}
    <p className="mt-2 text-sm text-gray-400">{new Chess(fen).turn() === "w" ? "White" : "Black"} to move</p>
  </div>;
}
