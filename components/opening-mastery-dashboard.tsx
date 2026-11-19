"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { filterMasterySnapshot, pendingReviewSaveCounts, summarizeMastery, summarizeRepertoireProgress, type TrainingSnapshot } from "@/lib/opening-mastery";

type Repertoire = { id: string; name: string; side: string; chapters: { id: string; name: string }[] };
type LaunchReview = (repertoireId?: string, chapterId?: string, positionId?: string) => void;

export function OpeningMasteryDashboard({ repertoires, onStartReview, onPracticePosition }: {
  repertoires: Repertoire[]; onStartReview: LaunchReview; onPracticePosition: LaunchReview;
}) {
  const [snapshots, setSnapshots] = useState<TrainingSnapshot[]>([]);
  const [selectedRepertoire, setSelectedRepertoire] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingCount, setPendingCount] = useState({ pending: 0, failed: 0 });

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const results = await Promise.all(repertoires.map(async (repertoire) => {
        const response = await fetch(`/api/openings/training?repertoireId=${encodeURIComponent(repertoire.id)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Could not load ${repertoire.name}.`);
        return data as TrainingSnapshot;
      }));
      setSnapshots(results);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Opening mastery data could not be loaded."); }
    finally { setLoading(false); }
  }, [repertoires]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    try { setPendingCount(pendingReviewSaveCounts(JSON.parse(localStorage.getItem("opening-training-pending-reviews-v1") ?? "[]"))); }
    catch { setPendingCount({ pending: 0, failed: 0 }); }
  }, [snapshots]);

  const progress = useMemo(() => summarizeRepertoireProgress(repertoires, snapshots), [repertoires, snapshots]);
  const focused = progress.find((entry) => entry.repertoire.id === selectedRepertoire) ?? null;
  const raw = snapshots.find((item) => item.repertoireId === selectedRepertoire) ?? null;
  const scope = raw ? filterMasterySnapshot(raw, selectedChapter) : null;
  const metrics = scope ? summarizeMastery(scope) : null;
  const allSummary = progress.reduce((total, item) => total + (item.summary?.due ?? 0), 0);

  return <section className="mt-5 rounded-2xl border border-white/[0.08] bg-[#11131b] p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a58aff]">Opening Academy · Mastery</p><h2 className="mt-1 text-xl font-medium">Opening Mastery</h2><p className="mt-1 text-xs text-[#918e9c]">Counts use active saved position identities. Due includes overdue and today; these groups do not overlap. Recently mastered means a saved interval of at least 21 days and not due today.</p></div>
      <button className="btn" disabled={loading || allSummary === 0} onClick={() => onStartReview()}>Start Today’s Reviews · {loading ? "…" : allSummary}</button>
    </div>
    {pendingCount.pending > 0 && <p role="status" className="mt-3 rounded border border-amber-400/30 bg-amber-400/5 p-2 text-xs text-amber-200">{pendingCount.pending} review save{pendingCount.pending === 1 ? " is" : "s are"} pending locally{pendingCount.failed ? `; ${pendingCount.failed} failed and need retry` : ""}. Statistics below include persisted records only. <button className="underline" onClick={() => onStartReview()}>Open trainer to retry</button></p>}
    {error && <div role="alert" className="mt-4 rounded-lg border border-red-400/20 p-3 text-sm text-red-200">{error} <button className="ml-2 underline" onClick={() => void refresh()}>Retry</button></div>}
    {loading && <p className="mt-5 text-sm text-gray-400">Loading saved opening reviews…</p>}
    {!loading && !error && !repertoires.length && <p className="mt-4 text-sm text-gray-400">Create a repertoire and add saved lines to begin tracking recall.</p>}
    {!loading && !error && !!repertoires.length && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Reviewable positions" value={progress.reduce((sum, item) => sum + (item.summary?.total ?? 0), 0)} note="Unique active chapter positions" />
        <Metric label="Due today" value={progress.reduce((sum, item) => sum + (item.summary?.dueToday ?? 0), 0)} note="Scheduled during today (UTC)" />
        <Metric label="Overdue" value={progress.reduce((sum, item) => sum + (item.summary?.overdue ?? 0), 0)} note="Scheduled before today (UTC)" />
        <Metric label="New" value={progress.reduce((sum, item) => sum + (item.summary?.newPositions ?? 0), 0)} note="Never reviewed, currently applicable" />
        <Metric label="Recently mastered" value={progress.reduce((sum, item) => sum + (item.summary?.recentlyMastered ?? 0), 0)} note="Interval ≥21 days, not due today" />
        <Metric label="Frequently forgotten" value={progress.reduce((sum, item) => sum + (item.summary?.repeatedlyForgotten ?? 0), 0)} note="Last two saved grades below 3" />
        <Metric label="First-attempt accuracy" value={weightedAccuracy(progress.map((item) => item.summary))} note="All persisted decision reviews" />
        <Metric label="Recent accuracy" value={weightedAccuracy(progress.map((item) => item.summary), true)} note="Up to last 20 persisted reviews per repertoire" />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <div className="rounded-xl border border-white/[0.07] p-4">
          <h3 className="text-sm font-medium">Repertoire progress</h3>
          <div className="mt-3 space-y-2">{progress.map(({ repertoire, summary, learned, due, accuracy, difficult }) => <button key={repertoire.id} onClick={() => { setSelectedRepertoire(repertoire.id); setSelectedChapter(""); }} className={`w-full rounded-lg border p-3 text-left ${selectedRepertoire === repertoire.id ? "border-purple-400/40 bg-purple-400/5" : "border-white/[0.06] hover:bg-white/[0.025]"}`}>
            <div className="flex justify-between gap-2"><span className="text-sm">{repertoire.side} · {repertoire.name}</span><span className="text-xs text-gray-400">{repertoire.chapters.length} chapters</span></div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-gray-400"><span>{learned}/{summary?.total ?? 0} learned*</span><span>{due} due</span><span>{accuracy === null ? "—" : `${Math.round(accuracy * 100)}% recent`}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full bg-purple-400" style={{ width: `${summary?.total ? Math.round(learned / summary.total * 100) : 0}%` }} /></div>
            <div className="mt-1 text-[10px] text-gray-500">{difficult} frequently forgotten · *learned means recently mastered by the interval definition above</div>
          </button>)}</div>
          {focused && <div className="mt-4 border-t border-white/[0.07] pt-3"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-medium">{focused.repertoire.name} · Chapters</h4><button className="text-xs text-purple-300" onClick={() => onStartReview(focused.repertoire.id)}>Review this repertoire</button></div>
            {focused.repertoire.chapters.map((entry) => { const stats = raw?.chapters.find((item) => item.chapterId === entry.id); return <button key={entry.id} onClick={() => setSelectedChapter(selectedChapter === entry.id ? "" : entry.id)} className={`mt-2 flex w-full justify-between rounded px-2 py-2 text-left text-xs ${selectedChapter === entry.id ? "bg-purple-500/15 text-purple-100" : "hover:bg-white/5 text-gray-300"}`}><span>{entry.name}</span><span>{stats?.due ?? 0} due · {stats?.applicable ?? 0} positions</span></button>; })}
          </div>}
        </div>
        <div className="space-y-4">
          <Chart title="Review activity · saved events per day" empty={!metrics?.activity.length}>
            {metrics?.activity.length ? <div className="flex h-28 items-end gap-1 border-b border-white/10 px-1">{metrics.activity.slice(-21).map((point) => <div key={point.date} className="group relative flex h-full flex-1 items-end" title={`${point.date}: ${point.reviews} reviews`}><div className="w-full rounded-t bg-purple-400/75" style={{ height: `${Math.max(4, point.reviews / Math.max(...metrics.activity.slice(-21).map((entry) => entry.reviews)) * 100)}%` }} /></div>)}</div> : null}
          </Chart>
          <Chart title="First-attempt accuracy · daily saved reviews" empty={!metrics?.activity.length}>
            {metrics?.activity.length ? <div className="flex h-24 items-center gap-1 border-b border-white/10 px-1">{metrics.activity.slice(-21).map((point) => <div key={point.date} className="flex h-full flex-1 items-center" title={`${point.date}: ${point.accuracy === null ? "no data" : `${Math.round(point.accuracy * 100)}%`}`}><div className="w-full rounded bg-emerald-400/75" style={{ height: `${point.accuracy === null ? 0 : Math.max(4, point.accuracy * 100)}%` }} /></div>)}</div> : null}
            <p className="mt-2 text-[10px] text-gray-500">Lifetime: {metrics?.lifetimeAccuracy === null || !metrics ? "not available yet" : `${Math.round(metrics.lifetimeAccuracy * 100)}% (${metrics.lifetimeReviews} reviews)`} · Recent: {metrics?.recentAccuracy === null || !metrics ? "not available yet" : `${Math.round(metrics.recentAccuracy * 100)}% (${metrics.recentReviewCount} reviews)`}</p>
          </Chart>
          <Chart title="Due-review workload · current schedule" empty={!metrics?.workload.some((item) => item.count || item.overdue)}>
            {metrics?.workload.some((item) => item.count || item.overdue) ? <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">{metrics.workload.map((point) => <div key={point.date} className="text-center"><div className="flex h-20 items-end justify-center gap-1"><span className="w-3 rounded-t bg-purple-400/75" style={{ height: `${Math.max(2, point.count / Math.max(1, ...metrics.workload.map((item) => item.count)) * 72)}px` }} /><span className="w-3 rounded-t bg-amber-400/70" style={{ height: `${point.overdue ? 72 : 2}px` }} /></div><div className="mt-1 text-[9px] text-gray-500">{point.label}</div></div>)}</div> : null}
            <p className="mt-1 text-[10px] text-gray-500">Purple: scheduled on date · amber today bar: overdue backlog. Future buckets reflect current saved next-review dates.</p>
          </Chart>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-white/[0.07] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-medium">Positions to revisit</h3><p className="text-[10px] text-gray-500">Repeatedly forgotten means the two latest saved grades are below 3. Chapters with no scheduled position are omitted.</p></div><div className="flex gap-2"><select className="field max-w-48" aria-label="Mastery repertoire filter" value={selectedRepertoire} onChange={(event) => { setSelectedRepertoire(event.target.value); setSelectedChapter(""); }}><option value="">All repertoires</option>{repertoires.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className="field max-w-44" aria-label="Mastery chapter filter" value={selectedChapter} onChange={(event) => setSelectedChapter(event.target.value)}><option value="">All chapters</option>{(focused?.repertoire.chapters ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></div>
        {!metrics?.difficult.length ? <p className="mt-3 text-sm text-gray-400">No repeatedly forgotten active positions in this selection.</p> : <div className="mt-3 grid gap-2 md:grid-cols-2">{metrics.difficult.map(({ position, reviews }) => {
          const chapterName = repertoires.find((item) => item.id === position.repertoireId)?.chapters.find((item) => item.id === position.chapterId)?.name ?? "Saved chapter";
          const failures = reviews.filter((item) => !item.firstAttemptCorrect).length;
          return <article key={position.identity} className="rounded-lg border border-white/[0.06] bg-black/10 p-3"><div className="flex items-start justify-between gap-2"><div><h4 className="text-xs">{repertoires.find((item) => item.id === position.repertoireId)?.name} · {chapterName}</h4><p className="mt-1 text-[10px] text-gray-500">{reviews.length} recent review{reviews.length === 1 ? "" : "s"} · {failures} unsuccessful first attempt{failures === 1 ? "" : "s"}</p><p className="mt-1 text-[10px] text-gray-500">Next review: {position.nextReviewAt ? new Date(position.nextReviewAt).toLocaleDateString() : "not scheduled"}</p></div><button className="btn shrink-0" onClick={() => onPracticePosition(position.repertoireId, position.chapterId, position.identity)}>Practice position</button></div><div className="mt-2 flex flex-wrap gap-1">{reviews.slice(0, 5).map((review) => <span key={review.id} className={`rounded px-1.5 py-1 text-[9px] ${review.firstAttemptCorrect ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"}`} title={`${new Date(review.reviewedAt).toLocaleString()} · grade ${review.grade}`}>{new Date(review.reviewedAt).toLocaleDateString()} · {review.firstAttemptCorrect ? "first try" : `grade ${review.grade}`}</span>)}</div></article>;
        })}</div>}
      </div>
      <p className="mt-3 text-[10px] text-gray-500">Recent accuracy uses up to 20 most recent saved reviews per repertoire. Categories such as overdue and frequently forgotten can overlap; summary categories are not additive. Pending local saves are excluded until persisted.</p>
      <p className="mt-1 text-[10px] text-gray-500">First-attempt accuracy is saved first-try successes divided by saved decision reviews; retries, hints, and reveals are not unaided first-attempt successes. “New” means active with no saved review history.</p>
      <button className="btn mt-3" disabled={!allSummary} onClick={() => onStartReview(selectedRepertoire || undefined, selectedChapter || undefined)}>Start selected reviews · {metrics?.due ?? allSummary}</button>
    </>}
  </section>;
}

function weightedAccuracy(summaries: ReturnType<typeof summarizeRepertoireProgress>[number]["summary"][], recent = false) {
  const rows = summaries.filter((item) => item && (recent ? item.recentAccuracy !== null : item.lifetimeAccuracy !== null));
  const denominator = rows.reduce((sum, item) => sum + (recent ? item!.recentReviewCount : item!.lifetimeReviews), 0);
  if (!denominator) return "Not available";
  const numerator = rows.reduce((sum, item) => sum + (recent ? item!.recentAccuracy! * item!.recentReviewCount : item!.lifetimeAccuracy! * item!.lifetimeReviews), 0);
  return `${Math.round(numerator / denominator * 100)}%`;
}
function Metric({ label, value, note }: { label: string; value: string | number; note: string }) { return <div className="rounded-lg border border-white/[0.06] bg-[#0c0e14] p-3"><div className="text-[9px] uppercase tracking-wide text-gray-500">{label}</div><div className="mt-2 text-xl text-gray-100">{value}</div><div className="mt-1 text-[10px] text-gray-500">{note}</div></div>; }
function Chart({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) { return <div className="rounded-xl border border-white/[0.07] p-3"><h3 className="mb-3 text-xs font-medium">{title}</h3>{empty ? <p className="py-5 text-center text-xs text-gray-500">No persisted review history yet.</p> : children}</div>; }
