"use client";

import { useMemo, useState } from "react";
import { PublicOpeningPractice } from "@/components/public-opening-practice";
import type { TrainingPosition } from "@/lib/opening-trainer";
import { publicPracticePosition } from "@/lib/public-opening-practice";
import { recordOpeningReview, type OpeningReview, type OpeningReviewOutcome } from "@/lib/public-opening-reviews";
import type { PublicProgress } from "@/lib/public-progress";

const control = "rounded-lg border border-white/15 px-3 py-2 text-sm text-[#d4e4dc] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#70d6b8]";

function decisionSignature(position: TrainingPosition) {
  return JSON.stringify([position.fen, [...position.continuations.keys()].sort()]);
}

export function PublicOpeningReviewSession({ queue, repertoires, reviews, update, onExit }: {
  queue: readonly OpeningReview[];
  repertoires: PublicProgress["repertoires"];
  reviews: PublicProgress["openingReviews"];
  update: (change: (progress: PublicProgress) => PublicProgress) => boolean;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState<Record<number, boolean>>({});
  const entry = queue[index];
  const repertoire = repertoires.find(({ id }) => id === entry?.repertoireId);
  const position = useMemo(() => repertoire && entry ? publicPracticePosition(repertoire, entry.nodeId) : null, [repertoire, entry]);
  const currentReview = reviews.find(({ repertoireId, nodeId }) => repertoireId === entry?.repertoireId && nodeId === entry.nodeId);
  const alreadySaved = completed[index] !== undefined;
  const available = repertoire && position?.continuations.size && position.turn === (repertoire.color === "white" ? "w" : "b");
  const next = () => setIndex((current) => current === index ? current + 1 : current);

  if (!entry || !available || (!alreadySaved && currentReview?.decisionId !== entry.decisionId)) {
    const results = Object.values(completed);
    return <section className="space-y-3 rounded-2xl border border-white/10 bg-[#111815] p-5" aria-live="polite">
      <p className="text-xs text-[#82ceb7]">{entry ? `Review Due · ${index + 1} of ${queue.length}` : "Review Due"}</p>
      <h2 className="text-xl font-semibold">{entry ? "Position no longer available" : "Review session complete"}</h2>
      {entry ? <p className="text-sm text-[#a4b5ab]">This decision was changed, removed, or already rescheduled.</p> :
        <p className="text-sm text-[#a4b5ab]">You completed {results.length} of {queue.length} reviews. Correct first attempts without help: {results.filter(Boolean).length}.</p>}
      <div className="flex flex-wrap gap-2">
        {entry && <button className={control} onClick={next}>Next Review</button>}
        <button className={control} onClick={onExit}>{entry ? "Exit Review" : "Back to repertoire"}</button>
      </div>
    </section>;
  }

  const signature = decisionSignature(position);
  function save(outcome: OpeningReviewOutcome) {
    const saved = update((progress) => {
      const live = progress.openingReviews.find(({ repertoireId, nodeId }) => repertoireId === outcome.repertoireId && nodeId === outcome.nodeId);
      if (live?.decisionId === outcome.decisionId) return progress;
      const latestRepertoire = progress.repertoires.find(({ id }) => id === outcome.repertoireId);
      const latestPosition = latestRepertoire && publicPracticePosition(latestRepertoire, outcome.nodeId);
      if (live?.decisionId !== entry?.decisionId || !latestPosition || decisionSignature(latestPosition) !== signature
        || latestPosition.turn !== (latestRepertoire?.color === "white" ? "w" : "b")) {
        throw new Error("This review position has changed.");
      }
      return { ...progress, openingReviews: recordOpeningReview(progress.openingReviews, outcome) };
    });
    if (saved) setCompleted((current) => ({ ...current, [index]: outcome.firstCorrect }));
    return saved;
  }

  return <PublicOpeningPractice key={`${index}:${signature}`} repertoire={repertoire} onReview={save} onExit={onExit}
    due={{ position, number: index + 1, total: queue.length, onNext: next }} />;
}
