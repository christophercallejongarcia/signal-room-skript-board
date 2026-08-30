import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { SLATE_HISTORY } from "@/lib/config";
import { parseSlateCompose, parseSlateDirection, withDirection, type SlateDirection } from "@/lib/slate";
import { findSlate, runSlate } from "@/lib/slate-run";

export const runtime = "nodejs";
/** One Codex turn through the bridge on top of the read; the bridge gives up after 120 s. */
export const maxDuration = 300;

/** The stored slates, newest first. The tab reads the first one and lets older days be picked. */
export async function GET() {
  return NextResponse.json({ slates: await getStorage().listSlates(SLATE_HISTORY) });
}

/**
 * Today's slate: the one that exists, or a fresh one through the same pass
 * POST /api/refresh runs after a Delta-Refresh. `{ force: true }` rebuilds the
 * day's slate; without it the day's document is left as it is.
 */
export async function POST(request: Request) {
  // parseSlateCompose reads the body; it is the only place that decides what a compose is.
  const { force } = parseSlateCompose(await request.json().catch(() => ({})));
  try {
    return NextResponse.json({ slate: await runSlate({ force }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

/** Stores the Richtung for the next run on one slate. An empty direction clears it. */
export async function PATCH(request: Request) {
  // parseSlateDirection bounds and rejects the body; it is the only place that decides what a direction is.
  let input: SlateDirection;
  try {
    input = parseSlateDirection(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const storage = getStorage();
  const slate = await findSlate(storage, input.id);
  if (!slate) return NextResponse.json({ error: `unknown slate ${input.id}` }, { status: 404 });
  const directed = withDirection(slate, input.direction, Date.now());
  await storage.saveSlate(directed);
  return NextResponse.json({ slate: directed });
}
