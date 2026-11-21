"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Lightbulb, RotateCcw } from "lucide-react";
import { PublicBoard } from "@/components/public-board";
import { useBoardAnimationDuration } from "@/components/use-board-animation-duration";
import { beginExercise, type Exercise, type TrainingPosition, playOpponent, requestHint, revealAnswer, submitTrainingMove } from "@/lib/opening-trainer";
import type { OpeningReviewOutcome } from "@/lib/public-opening-reviews";
import { publicPracticeOutcome, publicPracticeRoot } from "@/lib/public-opening-practice";
import type { PublicRepertoire } from "@/lib/public-repertoire";

const control = "inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-[#d4e4dc] hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#70d6b8] disabled:opacity-35";

type DueDecision = { position: TrainingPosition; number: number; total: number; onNext: () => void };

export function PublicOpeningPractice({ repertoire, onExit, onReview, due }: {
  repertoire: PublicRepertoire;
  onExit: () => void;
  onReview: (outcome: OpeningReviewOutcome) => boolean;
  due?: DueDecision;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const root = useMemo(() => due?.position ?? publicPracticeRoot(repertoire), [due?.position, repertoire]);
  const color = repertoire.color === "white" ? "w" : "b";
  const [exercise, setExercise] = useState(() => beginExercise(root, color));
  const currentExercise = useRef(exercise);
  const [coordinate, setCoordinate] = useState("");
  const [keyboardError, setKeyboardError] = useState("");
  const [pendingReview, setPendingReview] = useState<OpeningReviewOutcome | null>(null);
  const [reset, setReset] = useState(0);
  const duration = useBoardAnimationDuration();
  const complete = exercise.status === "complete" || Boolean(due && exercise.revealed);
  const playerTurn = exercise.status === "player" && !complete;

  function transition(next: Exercise) {
    currentExercise.current = next;
    setExercise(next);
  }

  useEffect(() => {
    if (exercise.status !== "opponent") return;
    const timer = window.setTimeout(() => {
      if (currentExercise.current === exercise) transition(playOpponent(exercise, Math.random));
    }, duration + 40);
    return () => window.clearTimeout(timer);
  }, [exercise, duration]);

  function play(input: Parameters<typeof submitTrainingMove>[1]) {
    const exercise = currentExercise.current;
    if (exercise.status !== "player" || (due && exercise.revealed)) return false;
    setKeyboardError("");
    const result = submitTrainingMove(exercise, input);
    let feedback = result.state.feedback;
    if (result.accepted && exercise.revealed) feedback = "Continued with help from the reveal.";
    if (result.state.incorrectHere > exercise.incorrectHere) feedback = `Incorrect. ${feedback} Try again.`;
    transition({ ...result.state, feedback, status: due && result.accepted ? "complete" : result.state.status });
    if (result.accepted && !exercise.revealed) saveReview(exercise);
    return result.accepted;
  }

  function submitCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!playerTurn) return;
    const move = coordinate.trim().toLowerCase().match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (!move) {
      setKeyboardError("Enter the starting and destination squares.");
      return;
    }
    if (play({ from: move[1], to: move[2], promotion: move[3] })) setCoordinate("");
  }

  function saveReview(state: Exercise) {
    const outcome = publicPracticeOutcome(repertoire.id, state, crypto.randomUUID(), Date.now());
    if (outcome && !onReview(outcome) && due) setPendingReview(outcome);
  }

  function reveal() {
    const current = currentExercise.current;
    const next = revealAnswer(current);
    if (next === current) return;
    transition(next);
    saveReview(next);
  }

  function retryMove() {
    transition({ ...currentExercise.current, feedback: "" });
    setCoordinate("");
    setKeyboardError("");
  }

  function restart() {
    transition(beginExercise(root, color));
    setReset((value) => value + 1);
    setCoordinate("");
    setKeyboardError("");
  }

  return <section className="rounded-2xl border border-white/10 bg-[#111815] p-4 sm:p-5">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-[#82ceb7]">{due ? `Review Due · ${due.number} of ${due.total}` : "Opening practice"}</p>
        <h2 ref={heading} tabIndex={-1} className="break-words text-xl font-semibold">{repertoire.name}</h2>
        <p className="mt-1 text-sm capitalize text-[#a4b5ab]">Play as {repertoire.color}</p>
      </div>
      <button className={control} onClick={onExit}><ArrowLeft size={16} /> {due ? "Exit Review" : "Back to repertoire"}</button>
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <PublicBoard id="public-opening-practice" key={reset} fen={exercise.position.fen} black={color === "b"} move={play} disabled={!playerTurn} clickPromotion={Boolean(due)} green />
      <div className="space-y-4 rounded-xl border border-white/10 bg-[#0c1210] p-4">
        <div role="status" aria-live="polite">
          {complete ? <h3 className="font-semibold text-[#a8eed8]">{due ? "Decision complete" : "Line complete"}</h3> :
            <h3 className="font-semibold">{playerTurn ? "Recall a repertoire move" : "Opponent to move…"}</h3>}
          {exercise.feedback && <p className="mt-2 text-sm text-[#c9ded3]">{exercise.feedback}</p>}
          {exercise.hint && <p className="mt-2 text-sm text-[#a8eed8]">Hint. {exercise.hint}</p>}
          {exercise.revealed && <p className="mt-2 text-sm text-[#f2d396]">Revealed move: <strong>{exercise.revealed}</strong>.{!due && " Play it on the board to continue."}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!complete && <>
            <button className={control} disabled={!playerTurn || Boolean(exercise.hint || exercise.revealed)} onClick={() => transition(requestHint(currentExercise.current))}><Lightbulb size={15} /> Hint</button>
            <button className={control} disabled={!playerTurn || Boolean(exercise.revealed)} onClick={reveal}>Reveal Move</button>
          </>}
          {due ? <>
            {playerTurn && exercise.incorrectHere > 0 && <button className={control} onClick={retryMove}>Retry</button>}
            {complete && <button className={control} disabled={Boolean(pendingReview)} onClick={due.onNext}>Next Review</button>}
          </> : <button className={control} onClick={restart}><RotateCcw size={15} /> {complete ? "Practice Again" : "Restart"}</button>}
        </div>
        {pendingReview && <p role="alert" className="text-sm text-[#f2d396]">
          Review could not be saved.{" "}
          <button className={control} onClick={() => { if (onReview(pendingReview)) setPendingReview(null); }}>Retry save</button>
        </p>}
        {!complete && <form className="space-y-2 border-t border-white/10 pt-3" onSubmit={submitCoordinates}>
          <label htmlFor="practice-coordinates" className="block text-sm">Keyboard move</label>
          <div className="flex flex-wrap gap-2">
            <input id="practice-coordinates" className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0a0e0d] px-2 py-2 font-mono text-sm focus-visible:outline-[#70d6b8]" maxLength={5}
              aria-describedby="practice-coordinate-help" autoComplete="off" autoCapitalize="none" spellCheck={false} value={coordinate} onChange={(event) => setCoordinate(event.target.value)} />
            <button className={control} disabled={!playerTurn || !coordinate.trim()}>Play move</button>
          </div>
          <p id="practice-coordinate-help" className="text-xs text-[#a4b5ab]">Enter two squares. Add q, r, b, or n for promotion.</p>
          {keyboardError && <p role="status" className="text-sm text-[#f2d396]">{keyboardError}</p>}
        </form>}
      </div>
    </div>
  </section>;
}
