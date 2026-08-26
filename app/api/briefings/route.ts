import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { runBriefing } from "@/lib/briefing-run";
import { BRIEFING_HISTORY } from "@/lib/config";

export const runtime = "nodejs";
/** One Codex turn through the bridge on top of the read; the bridge gives up after 120 s. */
export const maxDuration = 300;

/** The stored briefings, newest first. The tab reads the first one and lets older ones be picked. */
export async function GET() {
  return NextResponse.json({ briefings: await getStorage().listBriefings(BRIEFING_HISTORY) });
}

/**
 * Composes today's briefing now, through the same pass POST /api/refresh runs
 * after a Delta-Refresh. One document per day, so a second call rewrites it.
 */
export async function POST() {
  return NextResponse.json({ briefing: await runBriefing() });
}
