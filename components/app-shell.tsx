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
    <div className="min-h-screen bg-[#0b0d13] text-[#f4f3f8]">
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/65 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[258px] flex-col border-r border-white/[0.07] bg-[#101219] transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[82px] items-center justify-between border-b border-white/[0.07] px-6">
          <Link href="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#7655dc]/15 text-[#aa91ff]"><Crown size={21} strokeWidth={1.8} /></span>
            <span><span className="block text-[14px] font-semibold tracking-[0.01em]">KnightForge</span><span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.2em] text-[#918e9e]">Chess training</span></span>
          </Link>
          <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="text-[#898796] lg:hidden"><X size={19} /></button>
        </div>
        <div className="px-4 pt-7">
          <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#706e7c]">Training workspace</div>
          <nav className="space-y-1" aria-label="Main navigation">
            {items.map(({ label, href, icon: Icon }) => {
              const selected = pathname === href;
              return <Link key={href} href={href} onClick={() => setMobileOpen(false)} aria-current={selected ? "page" : undefined} className={`group flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors ${selected ? "bg-[#7655dc]/15 font-medium text-[#b6a3ff]" : "text-[#a2a0ad] hover:bg-white/[0.045] hover:text-white"}`}>
                <Icon size={17} strokeWidth={1.8} className={selected ? "text-[#a58aff]" : "text-[#777582] group-hover:text-[#bab5c7]"} />{label}
                {selected && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#9b7bff]" />}
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
        <header className="sticky top-0 z-20 flex h-[66px] items-center justify-between border-b border-white/[0.07] bg-[#0b0d13]/90 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3"><button aria-label="Open navigation" className="text-[#aaa7b4] lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><span className="text-[12px] text-[#777582]">Workspace</span><span className="text-[#4e4c57]">/</span><span className="text-[12px] text-[#d3d0db]">{active?.label ?? "Dashboard"}</span></div>
          {!publicMode && <LogoutButton />}
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-5 pb-14 pt-8 sm:px-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
