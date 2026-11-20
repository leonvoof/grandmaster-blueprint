"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Crown, Target } from "lucide-react";

export function Onboarding() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: form.get("displayName"), currentRating: form.get("currentRating"),
        weeklyStudyHours: form.get("weeklyStudyHours"), preferredSide: form.get("preferredSide"),
      }),
    });
    const result = await response.json();
    if (!response.ok) { setError(result.error ?? "Could not save your profile."); setBusy(false); return; }
    router.refresh();
  }

  return <div className="mx-auto max-w-[980px] py-5 sm:py-10">
    <div className="mb-8 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#7655dc]/15 text-[#aa91ff]"><Crown size={21} /></span><div><div className="text-[12px] font-semibold">KnightForge</div><div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-[#777582]">Your training starts here</div></div></div>
    <div className="grid overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11131b] lg:grid-cols-[1.02fr_0.98fr]">
      <div className="border-b border-white/[0.07] p-7 sm:p-10 lg:border-b-0 lg:border-r">
        <div className="text-[10px] font-semibold uppercase tracking-[0.19em] text-[#a58aff]">01 / Player profile</div>
        <h1 className="mt-5 max-w-md text-[34px] font-medium leading-[1.14] tracking-[-0.04em] sm:text-[40px]">A clear path from strong club player to Candidate Master.</h1>
        <p className="mt-4 max-w-md text-[13px] leading-6 text-[#9996a4]">Set your starting point. Your profile stays on this device and gives your training plan a useful baseline.</p>
        <div className="mt-8 space-y-3 text-[12px] text-[#c1beca]">
          {["A practical 2200 FIDE Standard goal", "Training built around your classical games", "Private local profile and settings"].map((item) => <div key={item} className="flex items-center gap-2.5"><Check size={14} className="text-[#9a82ee]" />{item}</div>)}
        </div>
      </div>
      <form onSubmit={submit} className="p-7 sm:p-10">
        <div className="mb-6 flex items-center gap-2 text-[13px] font-medium"><Target size={16} className="text-[#a58aff]" /> Set your starting point</div>
        <label className="mb-4 block"><span className="mb-2 block text-[11px] text-[#aaa7b4]">What should we call you?</span><input required name="displayName" maxLength={48} placeholder="Your name" className="h-11 w-full rounded-lg border border-white/[0.09] bg-[#0b0d13] px-3.5 text-[13px] outline-none placeholder:text-[#5f5d68] focus:border-[#8c70e2]" /></label>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label><span className="mb-2 block text-[11px] text-[#aaa7b4]">Current rating</span><input required name="currentRating" type="number" min="0" max="3500" defaultValue="1800" className="h-11 w-full rounded-lg border border-white/[0.09] bg-[#0b0d13] px-3.5 text-[13px] outline-none focus:border-[#8c70e2]" /></label>
          <div><span className="mb-2 block text-[11px] text-[#aaa7b4]">Rating pool</span><div className="flex h-11 items-center rounded-lg border border-white/[0.06] bg-white/[0.025] px-3.5 text-[12px] text-[#b8b5c0]">Lichess Classical</div></div>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label><span className="mb-2 block text-[11px] text-[#aaa7b4]">Study hours / week</span><input required name="weeklyStudyHours" type="number" min="1" max="60" defaultValue="10" className="h-11 w-full rounded-lg border border-white/[0.09] bg-[#0b0d13] px-3.5 text-[13px] outline-none focus:border-[#8c70e2]" /></label>
          <label><span className="mb-2 block text-[11px] text-[#aaa7b4]">Preferred side</span><select name="preferredSide" defaultValue="Both" className="h-11 w-full rounded-lg border border-white/[0.09] bg-[#0b0d13] px-3 text-[12px] text-[#dedbe6] outline-none focus:border-[#8c70e2]"><option>Both</option><option>White</option><option>Black</option></select></label>
        </div>
        <div className="mb-6 flex items-center justify-between rounded-lg border border-[#7655dc]/20 bg-[#7655dc]/[0.07] px-3.5 py-3"><div><div className="text-[11px] text-[#c9c0df]">Default goal</div><div className="mt-1 text-[13px] font-medium">Candidate Master · 2200 FIDE</div></div><Target size={17} className="text-[#a58aff]" /></div>
        {error && <p role="alert" className="mb-4 text-[12px] text-[#f19a9a]">{error}</p>}
        <button disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#7655dc] text-[12px] font-semibold text-white transition-colors hover:bg-[#8668e9] disabled:opacity-60">{busy ? "Saving profile…" : "Build my workspace"}<ArrowRight size={15} /></button>
        <p className="mt-3 text-center text-[10px] text-[#777582]">Saved locally. You can update this profile later.</p>
      </form>
    </div>
  </div>;
}
