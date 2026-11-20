import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Dashboard } from "@/components/dashboard";
import { Onboarding } from "@/components/onboarding";
import { siteMode } from "@/lib/site-mode";
import { PublicDashboard } from "@/components/public-dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const mode = siteMode();
  if (mode === "blocked") notFound();
  if (mode === "public") return <PublicDashboard />;
  const profile = await prisma.playerProfile.findUnique({ where: { id: "local-player" } });
  if (!profile?.onboardingComplete) return <Onboarding />;
  return <Dashboard profile={profile} />;
}
