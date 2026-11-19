import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, Clock3, Crosshair, Target, TrendingUp } from "lucide-react";
import { WeaknessSummary } from "@/components/weakness-summary";
import { OpeningMasterySummary } from "@/components/opening-mastery-summary";
import type { PlayerProfile } from "@prisma/client";

export function Dashboard({ profile }: { profile: PlayerProfile }) {
  return <div className="mx-auto max-w-[1180px]">
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div><div className="mb-3 flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-[#a58aff]"><span className="h-px w-5 bg-[#7655dc]" /> YOUR TRAINING BLUEPRINT</div><h1 className="text-[34px] font-medium tracking-[-0.04em] sm:text-[42px]">Good to have you here, {profile.displayName}.</h1><p className="mt-2 text-[13px] text-[#918e9c]">A strong process, one thoughtful session at a time.</p></div>
      <Link href="/coach" className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[#7655dc]/35 bg-[#7655dc]/10 px-4 text-[11px] font-medium text-[#c7b9ff] hover:bg-[#7655dc]/15">View training plan <ArrowRight size={14} /></Link>
    </div>
    <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="CURRENT RATING" value={profile.currentRating.toLocaleString()} note="Lichess Classical" icon={TrendingUp} />
      <Metric label="TARGET" value="2,200" note="Candidate Master · FIDE" icon={Target} accent />
      <Metric label="WEEKLY COMMITMENT" value={`${profile.weeklyStudyHours} hrs`} note="Your planned study time" icon={Clock3} />
      <Metric label="TRAINING STREAK" value="—" note="Log a session to begin" icon={Crosshair} />
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_0.9fr]">
      <section className="rounded-2xl border border-white/[0.075] bg-[#11131b] p-6 sm:p-7">
        <div className="flex items-start justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8e8b98]">Your road to 2200</div><h2 className="mt-2 text-[18px] font-medium">A foundation for focused improvement</h2></div><span className="rounded-md border border-[#7655dc]/20 bg-[#7655dc]/10 px-2 py-1 text-[9px] font-medium uppercase tracking-[0.1em] text-[#b9a7fa]">Starting point</span></div>
        <div className="mt-8 flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#0c0e14] px-4 py-3"><span className="text-[11px] text-[#aaa7b4]">Rating history</span><span className="text-[10px] text-[#777582]">No history recorded yet</span></div>
        <div className="mt-8 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-5"><div><div className="text-[10px] text-[#777582]">CURRENT POOL</div><div className="mt-1.5 text-[12px] text-[#ccc9d3]">{profile.ratingPlatform}</div></div><div><div className="text-[10px] text-[#777582]">GOAL TYPE</div><div className="mt-1.5 text-[12px] text-[#ccc9d3]">FIDE Standard</div></div><div><div className="text-[10px] text-[#777582]">PROGRESS</div><div className="mt-1.5 text-[12px] text-[#ccc9d3]">Profile baseline</div></div></div>
      </section>
      <section className="rounded-2xl border border-white/[0.075] bg-[#11131b] p-6 sm:p-7">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8e8b98]">Start with the essentials</div><h2 className="mt-2 text-[18px] font-medium">Make your practice count.</h2>
        <div className="mt-5 space-y-2.5"><QuickLink href="/games" icon={BookOpen} title="Bring in your games" text="Build a record to learn from." /><QuickLink href="/analysis" icon={Crosshair} title="Review a critical moment" text="Turn a decision into a lesson." /><QuickLink href="/tactics" icon={Target} title="Train your calculation" text="Build a steady daily habit." /></div>
      </section>
    </div>
    <WeaknessSummary />
    <OpeningMasterySummary />
    <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.018] px-5 py-4 text-[11px] leading-5 text-[#858290]"><span className="font-medium text-[#bcb8c5]">A note on your dashboard:</span> Rating history, streaks, and study statistics will appear as you record real activity. No training results are estimated or filled in.</div>
  </div>;
}

import type { LucideIcon } from "lucide-react";
function Metric({ label, value, note, icon: Icon, accent = false }: { label: string; value: string; note: string; icon: LucideIcon; accent?: boolean }) {
  return <div className="rounded-xl border border-white/[0.075] bg-[#11131b] p-4"><div className="flex items-center justify-between"><div className="text-[9px] font-semibold tracking-[0.14em] text-[#858290]">{label}</div><Icon size={15} className={accent ? "text-[#a58aff]" : "text-[#6f6c7a]"} /></div><div className={`mt-4 text-[25px] font-medium tracking-[-0.03em] ${accent ? "text-[#c5b5ff]" : "text-[#f0eef5]"}`}>{value}</div><div className="mt-1 text-[10px] text-[#81808c]">{note}</div></div>;
}
function QuickLink({ href, icon: Icon, title, text }: { href: string; icon: LucideIcon; title: string; text: string }) {
  return <Link href={href} className="group flex items-center gap-3 rounded-lg border border-white/[0.055] bg-[#0d0f15] p-3 transition-colors hover:border-[#7655dc]/30"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#7655dc]/10 text-[#a58aff]"><Icon size={15} /></span><span className="min-w-0 flex-1"><span className="block text-[11px] font-medium text-[#d6d3de]">{title}</span><span className="mt-1 block text-[10px] text-[#81808c]">{text}</span></span><ArrowUpRight size={14} className="text-[#666370] transition-colors group-hover:text-[#a58aff]" /></Link>;
}
