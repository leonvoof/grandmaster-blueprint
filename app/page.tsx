import { prisma } from "@/lib/prisma";
import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const profile = await prisma.playerProfile.findUnique({ where: { id: "local-player" } });
  if (!profile?.onboardingComplete) return <Onboarding />;
  return <Dashboard profile={profile} />;
}

import { Onboarding } from "@/components/onboarding";
