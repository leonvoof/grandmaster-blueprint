import { repertoireRoot, type PublicRepertoire } from "./public-repertoire.ts";

export type OpeningReviewOutcome = {
  repertoireId: string;
  nodeId: string;
  decisionId: string;
  reviewedAt: number;
  firstCorrect: boolean;
  incorrect: boolean;
  hinted: boolean;
  revealed: boolean;
};

export type OpeningReview = OpeningReviewOutcome & {
  dueAt: number;
  intervalMs: number;
  streak: number;
  successes: number;
  failures: number;
};

const minute = 60_000;
const day = 1440 * minute;
const intervals = [1, 3, 7, 14, 21, 30, 45, 60, 90];
const masteryStreak = 4;

// Repertoire edges are stored parent-first and validated before use. Each
// decision belongs to its path's parent node, even when two moves are accepted.
export function reviewableOpeningNodes(repertoire: PublicRepertoire) {
  const turns = new Map([[repertoireRoot, "white"]]);
  const nodes = new Set<string>();
  for (const { parent, id } of repertoire.moves) {
    const turn = turns.get(parent);
    if (turn === repertoire.color) nodes.add(parent);
    turns.set(id, turn === "white" ? "black" : "white");
  }
  return nodes;
}

export function recordOpeningReview(reviews: OpeningReview[], outcome: OpeningReviewOutcome) {
  const index = reviews.findIndex(({ repertoireId, nodeId }) =>
    repertoireId === outcome.repertoireId && nodeId === outcome.nodeId);
  const previous = reviews[index];
  if (previous && (previous.decisionId === outcome.decisionId || previous.reviewedAt >= outcome.reviewedAt)) return reviews;

  const clean = outcome.firstCorrect;
  const streak = clean ? Math.min((previous?.streak ?? 0) + 1, intervals.length) : 0;
  // A hint-assisted correct answer is due in 12 hours. A wrong answer
  // or reveal takes precedence and is due in 10 minutes.
  const intervalMs = clean ? intervals[streak - 1] * day :
    (outcome.incorrect || outcome.revealed) ? 10 * minute : 12 * 60 * minute;
  const review: OpeningReview = {
    ...outcome, streak, intervalMs, dueAt: outcome.reviewedAt + intervalMs,
    successes: (previous?.successes ?? 0) + Number(clean),
    failures: (previous?.failures ?? 0) + Number(!clean),
  };
  if (index === -1) return [...reviews, review];
  return reviews.map((item, i) => i === index ? review : item);
}

export function openingMastery(repertoire: PublicRepertoire, reviews: readonly OpeningReview[], now: number) {
  const nodes = reviewableOpeningNodes(repertoire);
  const counts = { newPositions: nodes.size, due: 0, learning: 0, mastered: 0 };
  for (const review of reviews) {
    if (review.repertoireId !== repertoire.id || !nodes.delete(review.nodeId)) continue;
    counts.newPositions--;
    if (review.dueAt <= now) counts.due++;
    if (review.streak >= masteryStreak) counts.mastered++;
    else counts.learning++;
  }
  return counts;
}

export function decodeOpeningReviews(input: unknown, repertoires: readonly PublicRepertoire[]): OpeningReview[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("Invalid opening review progress.");
  const liveNodes = new Map(repertoires.map((item) => [item.id, reviewableOpeningNodes(item)]));
  const reviews: OpeningReview[] = [];
  for (const value of input) {
    if (!value || typeof value.repertoireId !== "string" || typeof value.nodeId !== "string") throw new Error("Invalid opening review position.");
    const nodes = liveNodes.get(value.repertoireId);
    if (!nodes?.delete(value.nodeId)) continue;
    const { repertoireId, nodeId, decisionId, reviewedAt, firstCorrect, incorrect, hinted, revealed, dueAt, intervalMs, streak, successes, failures } = value;
    if (typeof decisionId !== "string" || !/^[a-f0-9-]{36}$/.test(decisionId)
      || ![reviewedAt, dueAt, intervalMs, streak, successes, failures].every((n) => Number.isSafeInteger(n) && n >= 0)
      || ![firstCorrect, incorrect, hinted, revealed].every((flag) => typeof flag === "boolean")
      || firstCorrect !== !(incorrect || hinted || revealed)
      || firstCorrect !== (streak > 0) || streak > intervals.length || streak > successes
      || intervalMs !== (firstCorrect ? intervals[streak - 1] * day : (incorrect || revealed) ? 10 * minute : 12 * 60 * minute)
      || dueAt !== reviewedAt + intervalMs) throw new Error("Invalid opening review result.");
    reviews.push({ repertoireId, nodeId, decisionId, reviewedAt, firstCorrect, incorrect, hinted, revealed, dueAt, intervalMs, streak, successes, failures });
  }
  return reviews;
}

export function dueOpeningReviews(repertoires: readonly PublicRepertoire[], reviews: readonly OpeningReview[], now: number) {
  const nodesByRepertoire = new Map(repertoires.map((item) => [item.id, reviewableOpeningNodes(item)]));
  const cleanRate = ({ successes, failures }: OpeningReview) => successes / Math.max(1, successes + failures);
  return reviews.filter((review) => review.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt || cleanRate(a) - cleanRate(b))
    .filter(({ repertoireId, nodeId }) => nodesByRepertoire.get(repertoireId)?.delete(nodeId));
}
