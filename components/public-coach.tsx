"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, Brain, Crosshair, GraduationCap } from "lucide-react";
import { readCoachAnalyses } from "@/lib/browser-game-review";
import { coachGames, coachPriorities, summarizeCoachGames, summarizeCoachTraining } from "@/lib/public-coach";
import { progressKey, readProgress } from "@/lib/public-progress";

const card = "min-w-0 rounded-2xl border border-white/10 bg-[#111815] p-4 sm:p-5";
const muted = "text-sm leading-6 text-[#a4b5ab]";
const link = "inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-[#a8eed8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#70d6b8]";
type Training = ReturnType<typeof summarizeCoachTraining>;
type Games = ReturnType<typeof summarizeCoachGames>;

export function PublicCoach() {
  const [training, setTraining] = useState<Training>();
  const [gameCount, setGameCount] = useState<number>();
  const [games, setGames] = useState<Games>();
  const [storageError, setStorageError] = useState(false);
  const [analysisError, setAnalysisError] = useState(false);

  useEffect(() => {
    let generation = 0;
    async function refresh() {
      const current = ++generation;
      let progress;
      try {
        progress = readProgress(localStorage);
        setTraining(summarizeCoachTraining(progress, Date.now()));
        setStorageError(false);
      } catch {
        setStorageError(true);
        return;
      }
      try {
        const library = await coachGames(progress.games);
        if (current !== generation) return;
        setGameCount(library.length);
        const saved = await readCoachAnalyses(library.map(({ id }) => id));
        if (current === generation) {
          setGames(summarizeCoachGames(library, saved));
          setAnalysisError(false);
        }
      } catch {
        if (current === generation) {
          setGames(undefined);
          setAnalysisError(true);
        }
      }
    }
    function onStorage(event: StorageEvent) {
      if (event.key === progressKey || event.key === null) void refresh();
    }
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      generation++;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const priorities = training ? coachPriorities(training, games) : [];
  const tactics = training?.tactics;
  const opening = training?.opening;
  return <div className="mx-auto max-w-[1180px] space-y-4">
    <header className="rounded-2xl border border-[#70d6b8]/20 bg-gradient-to-br from-[#172a23] to-[#101714] p-5 sm:p-8">
      <GraduationCap aria-hidden="true" className="mb-3 text-[#83ddc2]" size={26} />
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Personal Chess Coach</h1>
      <p className={`mt-2 ${muted}`}>See what your saved games, puzzle attempts, and opening reviews suggest you practice next.</p>
    </header>
    {storageError ? <p role="alert" className={card}>Training data could not be read from this browser.</p> : !training ?
      <p role="status" className={card}>Reading browser training data…</p> : <>
      <section aria-label="Training activity" className={card}>
        <h2 className="font-semibold">Training activity</h2>
        <Metrics values={[
          ["Saved games", gameCount ?? (analysisError ? "Unavailable" : "…")],
          ["Puzzle attempts", tactics!.attempted],
          ["Opening repertoires", opening!.repertoires],
          ["Reviewed opening positions", opening!.learning + opening!.mastered],
        ]} />
      </section>
      <section className={card}>
        <h2 className="font-semibold">Improvement priorities</h2>
        {!games && !analysisError ? <p role="status" className={`mt-2 ${muted}`}>Checking training evidence…</p> : priorities.length ? <ol className="mt-3 space-y-2">
          {priorities.map((priority) => <li key={priority.href} className="rounded-xl border border-white/10 bg-[#0c1210] p-3">
            <h3 className="font-medium text-[#a8eed8]">{priority.title}</h3>
            <p className={muted}>{priority.evidence}</p>
            <Link className={`mt-1 ${link}`} href={priority.href}>{priority.action} <ArrowRight size={15} aria-hidden="true" /></Link>
          </li>)}
        </ol> : <p className={`mt-2 ${muted}`}>No supported priority yet. Complete puzzle attempts, review opening positions, or run full-game analysis to build a useful sample.</p>}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Tactics performance" className={card}>
          <h2 className="flex items-center gap-2 font-semibold"><Brain size={18} aria-hidden="true" className="text-[#83ddc2]" /> Tactics performance</h2>
          {tactics!.attempted ? <>
            <Metrics values={[["Solved", `${tactics!.solved} / ${tactics!.attempted}`], ["Lifetime first-try rate", `${tactics!.rate}%`], ["Current clean streak", tactics!.currentCleanStreak]]} />
            <p className={`mt-3 ${muted}`}>First-try rates use solves with no incorrect move. Skips count as attempts.</p>
            {tactics!.recent.attempted >= 5 && <RecallBar label="Latest attempts" {...tactics!.recent} />}
            {tactics!.previous.attempted === 10 ? <RecallBar label="Previous attempts" {...tactics!.previous} /> :
              <p className={`mt-2 ${muted}`}>A trend comparison needs 20 recorded attempts.</p>}
          </> : <p className={`mt-2 ${muted}`}>No tracked attempts yet. A solve or skip starts your sample.</p>}
          <Link className={`mt-3 ${link}`} href="/tactics">Open Tactics <ArrowRight size={15} aria-hidden="true" /></Link>
        </section>
        <section aria-label="Opening recall" className={card}>
          <h2 className="flex items-center gap-2 font-semibold"><BookOpen size={18} aria-hidden="true" className="text-[#83ddc2]" /> Opening recall</h2>
          {opening!.repertoires ? <>
            <Metrics values={[["Due for review", opening!.due], ["New", opening!.newPositions], ["Learning", opening!.learning], ["Mastered", opening!.mastered]]} />
            <p className={`mt-3 ${muted}`}>Mastered positions have four consecutive unaided recalls. Due positions can be Learning or Mastered.</p>
            {opening!.successes + opening!.failures > 0 && <p className={muted}>{opening!.successes} of {opening!.successes + opening!.failures} recorded reviews were unaided successes.</p>}
          </> : <p className={`mt-2 ${muted}`}>Save a repertoire and practice its moves to start tracking recall.</p>}
          <Link className={`mt-3 ${link}`} href="/openings">Open Opening Academy <ArrowRight size={15} aria-hidden="true" /></Link>
        </section>
      </div>
      <section aria-label="Game mistake patterns" className={card}>
        <h2 className="flex items-center gap-2 font-semibold"><Crosshair size={18} aria-hidden="true" className="text-[#83ddc2]" /> Game mistake patterns</h2>
        {analysisError ? <p className={`mt-2 ${muted}`}>Saved analyses could not be read.</p> : !games ? <p role="status" className={`mt-2 ${muted}`}>Reading saved analyses…</p> : <>
          <p className={`mt-2 ${muted}`}>{games.complete} of {gameCount} saved games have complete, compatible analysis at depth 12 or higher.{games.unattributed > 0 && ` The import username could not be matched to a playing side in ${games.unattributed} of those games.`}</p>
          {games.assessed ? <>
            <p className={muted}>{games.assessed} of {games.ownMoves} moves on the matched import side were classifiable at {games.depths.length === 1 ? "depth" : "depths"} {games.depths.join(", ")}.</p>
            <Metrics values={[["Inaccuracies", games.inaccuracies], ["Mistakes", games.mistakes], ["Blunders", games.blunders]]} />
            {games.evidence.length > 0 && <ul className="mt-3 space-y-1 text-sm text-[#c6d9cf]">{games.evidence.map(({ title, issues }, index) => <li key={index} className="break-words">{title} · {issues} flagged {issues === 1 ? "move" : "moves"}</li>)}</ul>}
            <p className={`mt-3 ${muted}`}>These estimates use the default game-review thresholds and the deepest complete analysis per game. This reflects the usernames entered at import. Include your own games for personal feedback.</p>
          </> : <p className={`mt-2 ${muted}`}>No classifiable moves on a matched import side yet. Import a Lichess game and complete full-game analysis to add evidence.</p>}
        </>}
        <Link className={`mt-3 ${link}`} href="/games">Open Games <ArrowRight size={15} aria-hidden="true" /></Link>
      </section>
    </>}
  </div>;
}

function Metrics({ values }: { values: [string, ReactNode][] }) {
  return <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(125px,1fr))]">
    {values.map(([label, value]) => <div key={label} className="min-w-0 rounded-lg border border-white/[.07] bg-[#0c1210] p-2.5">
      <dt className="text-xs text-[#a4b5ab]">{label}</dt>
      <dd className="break-words text-xl font-semibold tabular-nums text-[#a8eed8]">{value}</dd>
    </div>)}
  </dl>;
}

function RecallBar({ label, attempted, clean, rate }: { label: string; attempted: number; clean: number; rate: number | null }) {
  return <div className="mt-2">
    <p className="flex flex-wrap justify-between gap-1 text-xs text-[#c6d9cf]"><span>{label}</span><span>{clean}/{attempted} · {rate}%</span></p>
    <div className="mt-1 h-1.5 rounded-full bg-white/10" aria-hidden="true"><div className="h-full rounded-full bg-[#70d6b8]" style={{ width: `${rate ?? 0}%` }} /></div>
  </div>;
}
