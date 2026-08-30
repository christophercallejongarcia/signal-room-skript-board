import { NextResponse } from "next/server";
import { runBriefing } from "@/lib/briefing-run";
import { runRefresh } from "@/lib/collect";
import { runSlate } from "@/lib/slate-run";

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

  // The slate reads the same corpus and needs the Bridge. One per day: a second
  // refresh finds the morning's slate and hands it back untouched.
  let slateId: string | undefined;
  try {
    slateId = (await runSlate()).id;
  } catch (error) {
    console.error("Slate after refresh failed:", error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ ...result, ...(briefingId ? { briefingId } : {}), ...(slateId ? { slateId } : {}) });
}
