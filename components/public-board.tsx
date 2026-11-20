"use client";

import { useEffect, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useBoardAnimationDuration } from "@/components/use-board-animation-duration";
import { legalMoveSquareStyles } from "@/lib/board-interaction";

export type BoardMove = { from: Square; to: Square; promotion?: string };

export function PublicBoard({ fen, move, black = false, green = false, disabled = false, id }: { fen: string; move: (move: BoardMove) => boolean; black?: boolean; green?: boolean; disabled?: boolean; id?: string }) {
  const [selection, setSelection] = useState<{ fen: string; square: Square } | null>(null);
  const selected = !disabled && selection?.fen === fen ? selection.square : null;
  const animationDuration = useBoardAnimationDuration();
  useEffect(() => { setSelection(null); }, [fen]);
  function click(square: Square) {
    const position = new Chess(fen);
    if (position.get(square)?.color === position.turn()) {
      setSelection(selected === square ? null : { fen, square });
      return;
    }
    if (!selected) return;
    const promotion = position.moves({ square: selected, verbose: true }).some((candidate) => candidate.to === square && candidate.promotion);
    if (!promotion) move({ from: selected, to: square });
    setSelection(null);
  }
  const moveStyles = selected ? legalMoveSquareStyles(fen, selected) : {};
  const squareStyles = { ...moveStyles, ...(selected ? { [selected]: { backgroundColor: "rgba(80, 200, 170, 0.55)", boxShadow: "inset 0 0 0 3px rgba(229, 255, 246, 0.75)" } } : {}) };
  return <div className="mx-auto w-full max-w-[560px]">
    <Chessboard id={id} position={fen} boardOrientation={black ? "black" : "white"} animationDuration={animationDuration}
      onSquareClick={disabled ? undefined : click}
      arePiecesDraggable={!disabled}
      customSquareStyles={squareStyles}
      customDarkSquareStyle={green ? { backgroundColor: "#42665e" } : undefined}
      customLightSquareStyle={green ? { backgroundColor: "#d8e5dc" } : undefined}
      onPieceDrop={(from, to) => { setSelection(null); return !disabled && move({ from, to }); }}
      onPromotionCheck={(from, to) => new Chess(fen).moves({ square: from, verbose: true }).some((candidate) => candidate.to === to && candidate.promotion)}
      onPromotionPieceSelect={(piece, from, to) => Boolean(!disabled && piece && from && to && move({ from, to, promotion: piece[1].toLowerCase() }))} />
    <p className="mt-2 text-sm text-gray-400">{new Chess(fen).turn() === "w" ? "White" : "Black"} to move</p>
  </div>;
}
