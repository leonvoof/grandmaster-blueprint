import { privateRouteDisabled } from "@/lib/site-mode";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { limits, LichessError, lookupLichessUser, parseUsername, speeds, syncLichessGames } from "@/lib/lichess";

export const runtime = "nodejs";
// Lichess sync streams incremental progress and commits each completed game.
// Keep the Hobby-compatible upper bound explicit so a long import fails in a
// predictable way and can be safely resumed through the existing dedupe path.
export const maxDuration = 60;
const settingsId = "local-player";

function errorResponse(error: unknown) {
  if (!(error instanceof LichessError)) {
    return { error: "Could not access local Lichess settings or games.", status: 500, retryAfter: undefined };
  }
  return { error: error.message, status: error.status, retryAfter: error.retryAfter };
}

export async function GET() {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  try {
    const settings = await prisma.lichessSettings.findUnique({ where: { id: settingsId } });
    return NextResponse.json({ settings });
  } catch (error) {
    const body = errorResponse(error);
    return NextResponse.json(body, { status: body.status });
  }
}

export async function PUT(request: Request) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  try {
    const body = await request.json().catch(() => null);
    const settings = await lookupLichessUser(parseUsername(body?.username));
    await prisma.lichessSettings.upsert({
      where: { id: settingsId }, create: { id: settingsId, ...settings }, update: settings,
    });
    return NextResponse.json({ settings });
  } catch (error) {
    const body = errorResponse(error);
    return NextResponse.json(body, {
      status: body.status,
      headers: body.retryAfter ? { "Retry-After": String(body.retryAfter) } : {},
    });
  }
}

export async function POST(request: Request) {
  const disabled = privateRouteDisabled();
  if (disabled) return disabled;
  const body = await request.json().catch(() => null);
  const speed = speeds.find((value) => value === body?.speed);
  const limit = limits.find((value) => value === body?.limit);
  if (!speed || !limit) return NextResponse.json({ error: "Choose a supported speed and game limit." }, { status: 400 });

  try {
    const settings = await prisma.lichessSettings.findUnique({ where: { id: settingsId } });
    if (!settings) return NextResponse.json({ error: "Save a Lichess username first." }, { status: 400 });

    const encoder = new TextEncoder();
    const counts = { imported: 0, skipped: 0, failed: 0 };
    let cancelled = false;
    const stream = new ReadableStream({
      async start(controller) {
        function emit(data: object) {
          if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        }

        try {
          await syncLichessGames(settings.username, speed, limit, counts, () => emit({ ...counts }));
          emit({ ...counts, done: true });
        } catch (error) {
          emit({ ...counts, done: true, ...errorResponse(error) });
        } finally {
          if (!cancelled) controller.close();
        }
      },
      cancel() { cancelled = true; },
    });
    return new Response(stream, { headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    } });
  } catch (error) {
    const response = errorResponse(error);
    return NextResponse.json(response, { status: response.status });
  }
}
