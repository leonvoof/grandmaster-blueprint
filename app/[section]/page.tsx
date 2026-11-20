import { notFound } from "next/navigation";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { pageDetails } from "@/lib/navigation";
import { GameViewer } from "@/components/game-viewer";
import { WeaknessReport } from "@/components/weakness-report";
import { OpeningAcademy } from "@/components/opening-academy";

import { PublicWorkspace } from "@/components/public-workspace";
import { siteMode } from "@/lib/site-mode";

export const dynamic = "force-dynamic";

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const mode = siteMode();
  if (mode === "blocked") notFound();
  if (mode === "public") {
    if (section === "games" || section === "analysis" || section === "openings" || section === "tactics") {
      return <PublicWorkspace section={section} />;
    }
    notFound();
  }
  const details = pageDetails[section];
  if (!details) notFound();
  if (section === "weaknesses") return <WeaknessReport />;
  if (section === "openings") return <OpeningAcademy />;
  if (section === "games") return <><h1 className="text-3xl">Games</h1><p className="mt-2 text-sm text-gray-400">Review a PGN or explore a position on the interactive board.</p><GameViewer /></>;
  return <div className="mx-auto max-w-[1000px]">
    <div className="mb-8 flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-[#9d87e8]"><span className="h-px w-5 bg-[#7655dc]" />{details.eyebrow}</div>
    <h1 className="max-w-2xl text-[34px] font-medium leading-[1.18] tracking-[-0.035em] text-[#f4f2f8] sm:text-[42px]">{details.title}</h1>
    <p className="mt-4 max-w-[620px] text-[14px] leading-7 text-[#9c99a7]">{details.description}</p>
    <div className="mt-10 grid gap-4 md:grid-cols-[1.35fr_1fr]">
      <section className="rounded-2xl border border-white/[0.075] bg-[#11131b] p-6 sm:p-8">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a994f0]"><Sparkles size={14} /> Foundation phase</div>
        <h2 className="mt-5 text-[19px] font-medium">A focused training space is taking shape.</h2>
        <p className="mt-2 max-w-md text-[13px] leading-6 text-[#8f8c9b]">This section is ready for its training workflow. It will use your saved profile and recorded work as those features are added.</p>
        <div className="mt-7 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#0c0e14] px-4 py-3 text-[12px] text-[#c0bdc8]"><span className="h-1.5 w-1.5 rounded-full bg-[#a58aff]" /> Next: {details.next}</div>
      </section>
      <aside className="rounded-2xl border border-white/[0.075] bg-[#11131b] p-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#777582]">The training standard</div>
        <p className="mt-4 text-[14px] leading-7 text-[#b5b2bf]">Every position, evaluation, and progress metric will come from a real game, verified source, or clearly labeled training data.</p>
        <div className="mt-6 flex items-center gap-2 text-[11px] text-[#898694]">Designed for long time controls <ArrowUpRight size={13} /></div>
      </aside>
    </div>
  </div>;
}
