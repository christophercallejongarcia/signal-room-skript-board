import { NextResponse } from "next/server";
import { runBriefing } from "@/lib/briefing-run";
import { runRefresh } from "@/lib/collect";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Delta-Refresh: pulls the window since each creator's lastCheckedAt, logs the run, catches up missing covers. */
export async function POST() {
  const result = await runRefresh();

  // Every refresh leaves a briefing behind (T6.2). It reads the corpus the refresh
  // just wrote, so it runs after and never in place of the collection: a briefing
  // that throws costs the morning's list, never the run that was already logged.
  let briefingId: string | undefined;
  try {
    briefingId = (await runBriefing()).id;
  } catch (error) {
    console.error("Briefing after refresh failed:", error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ ...result, ...(briefingId ? { briefingId } : {}) });
}
