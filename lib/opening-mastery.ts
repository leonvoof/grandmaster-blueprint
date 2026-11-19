export type MasteryPosition = {
  identity: string; repertoireId: string; chapterId: string; fen: string; contextPath: string[];
  applicable: boolean; nextReviewAt: string | null; intervalDays: number; repetition: number;
};
export type MasteryReview = {
  id: string; positionId: string; firstAttemptCorrect: boolean; incorrectAttempts: number;
  hintsUsed: number; answersRevealed: number; grade: number; reviewedAt: string;
  position: { identity: string; chapterId: string; fen: string; contextPath: string; expectedMoves: string; trainingColor: string; nextReviewAt: string | null; intervalDays: number; repetition: number };
};
export type TrainingSnapshot = {
  repertoireId: string; trainingColor: string; positions: MasteryPosition[];
  newPositions: MasteryPosition[]; overdue: MasteryPosition[]; dueToday: MasteryPosition[]; due: MasteryPosition[];
  recentlyMastered: MasteryPosition[]; repeatedlyForgotten: MasteryPosition[];
  stats: { applicable: number; new: number; due: number; overdue: number; recentlyMastered: number; repeatedlyForgotten: number };
  chapters: { chapterId: string; chapterName: string; applicable: number; new: number; due: number; overdue: number; recentlyMastered: number; repeatedlyForgotten: number }[];
  reviewHistory: MasteryReview[];
};

export function pendingReviewSaveCounts(value: unknown) {
  if (!Array.isArray(value)) return { pending: 0, failed: 0 };
  const failed = value.filter((entry) => entry && typeof entry === "object" && (entry as { status?: unknown }).status === "error").length;
  return { pending: value.length, failed };
}

const utcDay = (date: Date) => date.toISOString().slice(0, 10);

export function summarizeMastery(snapshot: TrainingSnapshot) {
  const active = snapshot.positions.filter((position) => position.applicable);
  const history = snapshot.reviewHistory.filter((review) => active.some((position) => position.identity === review.position.identity));
  const correct = history.filter((review) => review.firstAttemptCorrect).length;
  const recent = history.slice(0, 20);
  const recentCorrect = recent.filter((review) => review.firstAttemptCorrect).length;
  const activityMap = new Map<string, { reviews: number; correct: number }>();
  for (const review of history) {
    const date = utcDay(new Date(review.reviewedAt));
    const bucket = activityMap.get(date) ?? { reviews: 0, correct: 0 };
    bucket.reviews++;
    if (review.firstAttemptCorrect) bucket.correct++;
    activityMap.set(date, bucket);
  }
  const activity = [...activityMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
    date, reviews: value.reviews, accuracy: value.reviews ? value.correct / value.reviews : null,
  }));
  const overdueIds = new Set(snapshot.overdue.filter((item) => item.applicable).map((item) => item.identity));
  const dueTodayIds = new Set(snapshot.dueToday.filter((item) => item.applicable).map((item) => item.identity));
  const workload = Array.from({ length: 8 }, (_, offset) => {
    const date = new Date(); date.setUTCHours(0, 0, 0, 0); date.setUTCDate(date.getUTCDate() + offset);
    const key = utcDay(date);
    const count = offset === 0 ? dueTodayIds.size : active.filter((item) => item.nextReviewAt && utcDay(new Date(item.nextReviewAt)) === key).length;
    return { date: key, label: offset === 0 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }), count, overdue: offset === 0 ? overdueIds.size : 0 };
  });
  const recentByPosition = new Map<string, MasteryReview[]>();
  for (const review of history) {
    const key = review.position.identity;
    const rows = recentByPosition.get(key) ?? [];
    if (rows.length < 8) rows.push(review);
    recentByPosition.set(key, rows);
  }
  const difficult = snapshot.repeatedlyForgotten.filter((position) => position.applicable).map((position) => ({
    position, reviews: recentByPosition.get(position.identity) ?? [],
  }));
  return {
    total: active.length,
    due: dueTodayIds.size + overdueIds.size,
    dueToday: dueTodayIds.size,
    overdue: overdueIds.size,
    newPositions: active.filter((item) => !item.nextReviewAt && item.repetition === 0 && !history.some((review) => review.position.identity === item.identity)).length,
    recentlyMastered: snapshot.recentlyMastered.filter((item) => item.applicable).length,
    repeatedlyForgotten: difficult.length,
    lifetimeAccuracy: history.length ? correct / history.length : null,
    lifetimeReviews: history.length,
    recentAccuracy: recent.length ? recentCorrect / recent.length : null,
    recentReviewCount: recent.length,
    activity, workload, difficult,
    chapters: snapshot.chapters,
  };
}

export function filterMasterySnapshot(snapshot: TrainingSnapshot, chapterId = ""): TrainingSnapshot {
  if (!chapterId) return snapshot;
  const positions = snapshot.positions.filter((item) => item.chapterId === chapterId);
  const history = snapshot.reviewHistory.filter((item) => item.position.chapterId === chapterId);
  const chapters = snapshot.chapters.filter((item) => item.chapterId === chapterId);
  const stats = chapters[0] ?? { applicable: 0, new: 0, due: 0, overdue: 0, recentlyMastered: 0, repeatedlyForgotten: 0 };
  return {
    ...snapshot, positions,
    newPositions: snapshot.newPositions.filter((item) => item.chapterId === chapterId),
    overdue: snapshot.overdue.filter((item) => item.chapterId === chapterId),
    dueToday: snapshot.dueToday.filter((item) => item.chapterId === chapterId),
    due: snapshot.due.filter((item) => item.chapterId === chapterId),
    recentlyMastered: snapshot.recentlyMastered.filter((item) => item.chapterId === chapterId),
    repeatedlyForgotten: snapshot.repeatedlyForgotten.filter((item) => item.chapterId === chapterId),
    chapters, reviewHistory: history,
    stats: { applicable: stats.applicable, new: stats.new, due: stats.due, overdue: stats.overdue, recentlyMastered: stats.recentlyMastered, repeatedlyForgotten: stats.repeatedlyForgotten },
  };
}

export function summarizeRepertoireProgress(repertoires: { id: string; name: string; side: string; chapters: { id: string; name: string }[] }[], snapshots: TrainingSnapshot[]) {
  return repertoires.map((repertoire) => {
    const snapshot = snapshots.find((entry) => entry.repertoireId === repertoire.id);
    const summary = snapshot ? summarizeMastery(snapshot) : null;
    return {
      repertoire, summary,
      learned: summary?.recentlyMastered ?? 0,
      due: summary?.due ?? 0,
      accuracy: summary?.recentAccuracy ?? null,
      difficult: summary?.repeatedlyForgotten ?? 0,
      progress: summary && summary.total ? summary.recentlyMastered / summary.total : null,
    };
  });
}
