import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Dashboard } from "@/components/dashboard";
import { Onboarding } from "@/components/onboarding";
import { siteMode } from "@/lib/site-mode";

export const dynamic = "force-dynamic";

export default async function Home() {
  const mode = siteMode();
  if (mode === "blocked") notFound();
  if (mode === "public") return (
    <section className="mx-auto max-w-5xl py-10">
      <p className="text-sm font-semibold uppercase tracking-widest text-violet-300">Chess training</p>
      <h1 className="mt-3 text-5xl font-semibold tracking-tight sm:text-7xl">KnightForge</h1>
      <p className="mt-5 max-w-xl text-lg text-gray-300">Study your games with Stockfish, practice your opening lines, and sharpen your tactics.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link className="rounded-lg bg-violet-400 px-4 py-3 font-semibold text-slate-950" href="/analysis">Open the board</Link>
        <Link className="rounded-lg border border-white/20 px-4 py-3" href="/openings">Practice openings</Link>
        <Link className="rounded-lg border border-white/20 px-4 py-3" href="/tactics">Solve puzzles</Link>
      </div>
      <p className="mt-8 max-w-xl text-sm text-gray-400">No account required. Games and training progress stay in this browser. Use Backup &amp; restore to keep a copy or move between devices.</p>
    </section>
  );
  const profile = await prisma.playerProfile.findUnique({ where: { id: "local-player" } });
  if (!profile?.onboardingComplete) return <Onboarding />;
  return <Dashboard profile={profile} />;
}
