"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, Crown, Settings2 } from "lucide-react";
import { publicPages } from "@/lib/site-mode";
import { navigation } from "@/lib/navigation";
import { LogoutButton } from "@/components/auth-controls";

export function AppShell({ children, publicMode }: { children: React.ReactNode; publicMode: boolean }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = publicMode ? navigation.filter(({ href }) => publicPages.some((page) => page === href)) : navigation;
  const active = items.find((item) => item.href === pathname);
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className={`min-h-screen text-[#f4f3f8] ${publicMode ? "knightforge-public-shell bg-[#0a0e0d]" : "bg-[#0b0d13]"}`}>
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/65 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[258px] flex-col border-r transition-transform duration-200 lg:translate-x-0 ${publicMode ? "knightforge-public-sidebar border-white/[.075] bg-[#0e1412]" : "border-white/[0.07] bg-[#101219]"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className={`flex h-[82px] items-center justify-between border-b px-5 ${publicMode ? "border-white/[.075]" : "border-white/[0.07]"}`}>
          <Link href="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
            <span className={`grid h-10 w-10 place-items-center rounded-xl ${publicMode ? "bg-[#70d6b8]/10 text-[#83ddc2] ring-1 ring-[#70d6b8]/15" : "bg-[#7655dc]/15 text-[#aa91ff]"}`}><Crown size={21} strokeWidth={1.8} /></span>
            <span><span className="block text-[15px] font-semibold tracking-[-.025em]">KnightForge</span><span className={`mt-0.5 block text-[9px] font-semibold uppercase tracking-[.21em] ${publicMode ? "text-[#81918a]" : "text-[#918e9e]"}`}>Chess training</span></span>
          </Link>
          <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-[#898796] transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#70d6b8] lg:hidden"><X size={19} /></button>
        </div>
        <div className="px-3 pt-7">
          <div className={`mb-3 px-3 text-[9px] font-semibold uppercase tracking-[.2em] ${publicMode ? "text-[#65746d]" : "text-[#706e7c]"}`}>Training workspace</div>
          <nav className={publicMode ? "space-y-1.5" : "space-y-1"} aria-label="Main navigation">
            {items.map(({ label, href, icon: Icon }) => {
              const selected = pathname === href;
              return <Link key={href} href={href} onClick={() => setMobileOpen(false)} aria-current={selected ? "page" : undefined} className={`group relative flex ${publicMode ? "h-11 rounded-xl" : "h-10 rounded-lg"} items-center gap-3 px-3 text-[13px] transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ${publicMode ? selected ? "bg-[#70d6b8]/[.105] font-semibold text-[#a8eed8] before:absolute before:bottom-2.5 before:left-0 before:top-2.5 before:w-[2px] before:rounded-full before:bg-[#70d6b8] before:content-[''] focus-visible:outline-[#70d6b8]" : "text-[#9aa9a1] hover:bg-white/[.04] hover:text-[#e2ece6] focus-visible:outline-[#70d6b8]" : selected ? "bg-[#7655dc]/15 font-medium text-[#b6a3ff] focus-visible:outline-[#a58aff]" : "text-[#a2a0ad] hover:bg-white/[0.045] hover:text-white focus-visible:outline-[#a58aff]"}`}>
                <Icon size={17} strokeWidth={1.8} className={publicMode ? selected ? "text-[#70d6b8]" : "text-[#718079] group-hover:text-[#9ce6ce]" : selected ? "text-[#a58aff]" : "text-[#777582] group-hover:text-[#bab5c7]"} />{label}
                {selected && <span className={`ml-auto h-1.5 w-1.5 rounded-full ${publicMode ? "bg-[#70d6b8] shadow-[0_0_10px_#70d6b877]" : "bg-[#9b7bff]"}`} />}
              </Link>;
            })}
          </nav>
        </div>
        <div className="mt-auto border-t border-white/[0.07] p-4">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
            <div className="flex items-center gap-2 text-[11px] font-medium text-[#d7d4df]"><span className="h-1.5 w-1.5 rounded-full bg-[#8b72de]" /> THE LONG GAME</div>
            <p className="mb-0 mt-2 text-[11px] leading-[1.6] text-[#888694]">Consistent, thoughtful work beats shortcuts. Make every study session count.</p>
          </div>
          {!publicMode && <div className="mt-4 flex items-center gap-3 px-1">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#272331] text-[12px] font-semibold text-[#b5a2ef]">KF</div>
            <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium">Your profile</div><div className="mt-0.5 text-[10px] text-[#777582]">Local workspace</div></div>
            <Settings2 size={16} className="text-[#777582]" />
          </div>}
        </div>
      </aside>
      <div className="min-h-screen lg:pl-[258px]">
        <header className={`sticky top-0 z-20 flex h-[66px] items-center justify-between border-b backdrop-blur-xl ${publicMode ? "border-white/[.075] bg-[#0a0e0d]/90 px-4 sm:px-8" : "border-white/[0.07] bg-[#0b0d13]/90 px-5 sm:px-8"}`}>
          <div className="flex items-center gap-3"><button aria-label="Open navigation" aria-expanded={mobileOpen} className={`rounded-lg p-2 transition-colors focus-visible:outline focus-visible:outline-2 lg:hidden ${publicMode ? "text-[#a3b3aa] hover:bg-[#70d6b8]/[.08] hover:text-[#a8eed8] focus-visible:outline-[#70d6b8]" : "text-[#aaa7b4] focus-visible:outline-[#a58aff]"}`} onClick={() => setMobileOpen(true)}><Menu size={20} /></button><span className={`text-[11px] ${publicMode ? "text-[#718079]" : "text-[#777582]"}`}>{publicMode ? "KNIGHTFORGE" : "Workspace"}</span><span className={publicMode ? "text-[#384b42]" : "text-[#4e4c57]"}>/</span><span className={`text-[12px] font-medium ${publicMode ? "text-[#d5e3db]" : "text-[#d3d0db]"}`}>{active?.label ?? "Dashboard"}</span></div>
          {!publicMode && <LogoutButton />}
        </header>
        <main className={`mx-auto w-full max-w-[1440px] pb-14 ${publicMode && (pathname === "/games" || pathname === "/analysis") ? "px-3 pt-4 sm:px-6" : publicMode ? "px-4 pt-5 sm:px-7 sm:pt-7 lg:px-10 lg:pt-9" : "px-5 pt-8 sm:px-8 lg:px-10"}`}>{children}</main>
      </div>
    </div>
  );
}
