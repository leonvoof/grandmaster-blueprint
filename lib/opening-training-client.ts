import type { Exercise } from "@/lib/opening-trainer";

export type OpeningReviewSavePayload = {
  repertoireId: string;
  chapterId: string;
  positionId: string;
  trainingColor: "w" | "b";
  idempotencyKey: string;
  submittedMove: string | null;
  incorrectAttempts: number;
  hintsUsed: number;
  answersRevealed: number;
};

export type ReviewPositionContext = {
  startingFen: string;
  fen: string;
  contextPath: readonly string[];
};

export function matchesReviewPosition(
  candidate: ReviewPositionContext & { trainingColor: "w" | "b"; applicable: boolean },
  current: ReviewPositionContext & { trainingColor: "w" | "b" },
) {
  return candidate.applicable && candidate.trainingColor === current.trainingColor
    && candidate.startingFen === current.startingFen && candidate.fen === current.fen
    && candidate.contextPath.length === current.contextPath.length
    && candidate.contextPath.every((san, index) => san === current.contextPath[index]);
}

export function makeReviewSavePayload(input: {
  repertoireId: string;
  chapterId: string;
  positionId: string;
  idempotencyKey: string;
  exercise: Exercise;
  submittedMove: string | null;
}): OpeningReviewSavePayload {
  return {
    repertoireId: input.repertoireId,
    chapterId: input.chapterId,
    positionId: input.positionId,
    trainingColor: input.exercise.color,
    idempotencyKey: input.idempotencyKey,
    submittedMove: input.submittedMove,
    incorrectAttempts: input.exercise.incorrectHere,
    hintsUsed: input.exercise.hintsHere,
    answersRevealed: input.exercise.revealsHere,
  };
}

export async function postOpeningReview(
  payload: OpeningReviewSavePayload,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("/api/openings/training", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null) as { error?: string; duplicate?: boolean } | null;
  if (!response.ok) throw new Error(body?.error ?? "Review save failed.");
  return body;
}
