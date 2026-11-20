import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

import { siteMode } from "@/lib/site-mode";

export const metadata: Metadata = {
  title: "KnightForge",
  description: "Study games, practice openings, and solve chess puzzles.",
  openGraph: { title: "KnightForge", description: "Study games, practice openings, and solve chess puzzles.", type: "website" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppShell publicMode={siteMode() === "public"}>{children}</AppShell></body></html>;
}
