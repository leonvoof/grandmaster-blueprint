"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, Brain, ChartNoAxesCombined, CircleDot, Gamepad2, Target } from "lucide-react";
import { readProgress, type PublicGame } from "@/lib/public-progress";

export function PublicDashboard() {
  const [games, setGames] = useState<PublicGame[] | null>(null);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    try { setGames(readProgress(localStorage).games.filter((game) => game.kind === "game").slice(-3).reverse()); }
    catch { setStorageError(true); }
  }, []);

  return <div className="knightforge-public-home mx-auto max-w-[1240px]">
    <section className="kf-home-hero relative overflow-hidden rounded-[1.6rem] border border-white/[.075] px-6 py-8 sm:px-10 sm:py-11 lg:px-12">
      <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-emerald-300/[.055] blur-3xl" />
      <div className="relative max-w-3xl">
        <div className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[#7ce0c1]"><span className="h-px w-7 bg-[#55cda9]" /> Your chess workspace</div>
        <h1 className="text-4xl font-semibold tracking-[-.055em] text-[#f2f7f4] sm:text-5xl lg:text-[3.6rem]">Build your game,<br className="hidden sm:block" /> one decision at a time.</h1>
        <p className="mt-5 max-w-2xl text-sm leading-7 text-[#a3b0ab] sm:text-base">Review your games with local Stockfish, explore positions, and train tactics. Your games and progress stay in this browser.</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/games" className="kf-home-primary inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold">Open your games <ArrowRight size={16} /></Link>
          <Link href="/tactics" className="kf-home-secondary inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"><Target size={16} /> Train tactics</Link>
        </div>
      </div>
      <div className="relative mt-9 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/[.08] pt-4 text-xs text-[#83918b] sm:mt-11">
        <span className="inline-flex items-center gap-2"><CircleDot size={14} className="text-[#70d6b8]" /> Stockfish runs locally</span>
        <span>PGNs are stored in this browser</span>
      </div>
    </section>

    <section className="mt-8" aria-labelledby="public-workspace-heading">
      <div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.17em] text-[#70d6b8]">Choose your focus</p><h2 id="public-workspace-heading" className="mt-1.5 text-xl font-semibold tracking-tight text-[#edf3f0]">A focused place to improve</h2></div></div>
      <div className="grid gap-3 md:grid-cols-3">
        <Feature href="/games" icon={Gamepad2} number="01" title="Game review" detail="Import a PGN or Lichess games, then replay and analyze positions." action="Open Games" />
        <Feature href="/analysis" icon={BookOpen} number="02" title="Explore a position" detail="Set up a position, try candidate moves, and ask local Stockfish." action="Open analysis board" />
        <Feature href="/tactics" icon={Brain} number="03" title="Tactics practice" detail="Work through the available verified puzzle set at your own pace." action="Start practice" />
      </div>
    </section>

    <section className="mt-8 grid gap-4 lg:grid-cols-[1.35fr_.8fr]">
      <div className="kf-home-card min-w-0 rounded-2xl border border-white/[.075] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#81918a]">Pick up where you left off</p><h2 className="mt-1.5 text-lg font-semibold text-[#edf3f0]">Recent games</h2></div><Link href="/games" className="inline-flex items-center gap-1 text-xs font-medium text-[#83ddc2] hover:text-[#b1f2dd] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#70d6b8]">All games <ArrowUpRight size={14} /></Link></div>
        {storageError ? <p className="mt-5 rounded-xl border border-amber-300/15 bg-amber-200/[.04] p-4 text-sm text-amber-100/80">Browser game storage could not be read. Open Games to retry or restore a backup.</p>
          : games === null ? <div className="mt-5 h-16 animate-pulse rounded-xl bg-white/[.035]" aria-label="Loading recent games" />
            : games.length ? <div className="mt-4 divide-y divide-white/[.06]">{games.map((game, index) => <Link key={`${game.name}:${index}`} href="/games" className="group flex min-w-0 items-center gap-3 py-3 first:pt-1 last:pb-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#70d6b8]"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#70d6b8]/[.09] text-[#7ce0c1]"><BookOpen size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[#dbe5e0] group-hover:text-white">{game.name}</span><span className="mt-0.5 block text-[11px] text-[#7e8d86]">Saved in this browser</span></span><ArrowRight size={15} className="shrink-0 text-[#65746d] transition-transform group-hover:translate-x-0.5 group-hover:text-[#70d6b8]" /></Link>)}</div>
            : <div className="mt-4 rounded-xl border border-dashed border-white/[.1] bg-black/[.12] px-4 py-5"><p className="text-sm font-medium text-[#d4ddd8]">Your game library is ready.</p><p className="mt-1 text-xs leading-5 text-[#899790]">Import a PGN or fetch recent public games from Lichess to begin reviewing.</p><Link href="/games" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#83ddc2]">Import a game <ArrowRight size={14} /></Link></div>}
      </div>
      <aside className="kf-home-card rounded-2xl border border-white/[.075] p-5 sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#81918a]">Your data, your browser</p><h2 className="mt-1.5 text-lg font-semibold text-[#edf3f0]">Pick up on this device</h2>
        <p className="mt-3 text-sm leading-6 text-[#96a39d]">Saved PGNs, reviews, and training progress stay with this browser. Use the Games backup controls to keep a copy or move your workspace.</p>
        <Link href="/games" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#83ddc2] hover:text-[#b1f2dd]">Go to your library <ArrowRight size={14} /></Link>
      </aside>
    </section>
    <div className="mt-6 flex items-center gap-2 text-[11px] text-[#64736c]"><ChartNoAxesCombined size={14} /> Training summaries appear when supported by saved activity.</div>
  </div>;
}

function Feature({ href, icon: Icon, number, title, detail, action }: { href: string; icon: typeof Gamepad2; number: string; title: string; detail: string; action: string }) {
  return <Link href={href} className="kf-home-feature group rounded-2xl border border-white/[.075] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#70d6b8]/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#70d6b8] sm:p-6"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#70d6b8]/[.085] text-[#7ce0c1]"><Icon size={19} strokeWidth={1.8} /></span><span className="font-mono text-[10px] tracking-widest text-[#52635b]">{number}</span></div><h3 className="mt-5 text-base font-semibold text-[#e6eee9]">{title}</h3><p className="mt-2 min-h-12 text-xs leading-5 text-[#8e9c95]">{detail}</p><span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#83ddc2]">{action}<ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span></Link>;
}
