import { privateRouteDisabled } from "@/lib/site-mode";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const profile = await prisma.playerProfile.findUnique({ where: { id: "local-player" } });
  return NextResponse.json({ profile });
}

export async function POST(request: Request) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const body: unknown = await request.json();
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid profile." }, { status: 400 });
  const data = body as Record<string, unknown>;
  const displayName = typeof data.displayName === "string" ? data.displayName.trim().slice(0, 48) : "";
  const currentRating = Number(data.currentRating);
  const weeklyStudyHours = Number(data.weeklyStudyHours);
  const preferredSide = data.preferredSide;
  if (!displayName) return NextResponse.json({ error: "Enter a name to continue." }, { status: 400 });
  if (!Number.isInteger(currentRating) || currentRating < 0 || currentRating > 3500) return NextResponse.json({ error: "Enter a rating between 0 and 3500." }, { status: 400 });
  if (!Number.isInteger(weeklyStudyHours) || weeklyStudyHours < 1 || weeklyStudyHours > 60) return NextResponse.json({ error: "Choose 1 to 60 weekly study hours." }, { status: 400 });
  if (preferredSide !== "White" && preferredSide !== "Black" && preferredSide !== "Both") return NextResponse.json({ error: "Choose a valid color preference." }, { status: 400 });

  const profile = await prisma.playerProfile.upsert({
    where: { id: "local-player" },
    create: { id: "local-player", displayName, currentRating, weeklyStudyHours, preferredSide: preferredSide as string, onboardingComplete: true },
    update: { displayName, currentRating, weeklyStudyHours, preferredSide: preferredSide as string, onboardingComplete: true },
  });
  return NextResponse.json({ profile });
}
