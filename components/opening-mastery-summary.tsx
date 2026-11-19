"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Repertoire = { id: string; name: string; side: string };
export function OpeningMasterySummary() {
  const [summary, setSummary] = useState<{ repertoires: Repertoire[]; due: number; positions: number; mastered: number; reviews: { firstAttemptCorrect: boolean; reviewedAt: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/openings", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load repertoires.");
        const repertoires = body.repertoires as (Repertoire & { chapters: { id: string }[] })[];
        const snapshots = await Promise.all(repertoires.map(async (item) => {
          const result = await fetch(`/api/openings/training?repertoireId=${encodeURIComponent(item.id)}`, { cache: "no-store" });
          const data = await result.json();
          if (!result.ok) throw new Error(data.error ?? "Could not load opening review data.");
          return data;
        }));
        const value = {
          repertoires,
          due: snapshots.reduce((sum, item) => sum + item.stats.due, 0),
          positions: snapshots.reduce((sum, item) => sum + item.stats.applicable, 0),
          mastered: snapshots.reduce((sum, item) => sum + item.stats.recentlyMastered, 0),
          reviews: snapshots.flatMap((item) => item.reviewHistory as { firstAttemptCorrect: boolean; reviewedAt: string }[]).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)),
        };
        if (!cancelled) setSummary(value);
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Opening mastery summary unavailable."); }
    })();
    return () => { cancelled = true; };
  }, [refreshToken]);
  useEffect(() => {
    const refresh = () => setRefreshToken((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const recent = summary?.reviews.slice(0, 20) ?? [];
  const accuracy = recent.length ? `${Math.round(recent.filter((item) => item.firstAttemptCorrect).length / recent.length * 100)}%` : "Not available";
  return <section className="mt-4 rounded-2xl border border-[#7655dc]/20 bg-[#11131b] p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a58aff]">Opening Academy</div><h2 className="mt-1 text-[18px] font-medium">My Opening Mastery</h2><p className="mt-1 text-[11px] text-[#8f8c9b]">Saved review results only; pending local saves are not included.</p></div><Link href="/openings" className="btn">Full mastery report</Link></div>
    {error ? <p role="status" className="mt-4 text-xs text-amber-200">{error}</p> : !summary ? <p className="mt-4 text-xs text-gray-400">Loading persisted opening progress…</p> : <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div><div className="text-[9px] uppercase text-gray-500">Due reviews</div><div className="mt-1 text-2xl">{summary.due}</div></div>
      <div><div className="text-[9px] uppercase text-gray-500">Recent first-attempt accuracy</div><div className="mt-1 text-lg">{accuracy}{recent.length ? <span className="ml-1 text-[10px] text-gray-500">· {recent.length} reviews</span> : null}</div></div>
      <div className="min-w-44 flex-1"><div className="text-[9px] uppercase text-gray-500">Repertoire progress</div><div className="mt-1 text-xs text-gray-300">{summary.repertoires.length} repertoires · {summary.mastered}/{summary.positions} recently mastered</div><div className="mt-1 text-[10px] text-gray-500">{summary.repertoires.slice(0, 3).map((item) => `${item.side}: ${item.name}`).join(" · ") || "No saved repertoires yet"}</div></div>
      <Link href="/openings?practice=due" className="btn">Start Review · {summary.due}</Link>
    </div>}
  </section>;
}
