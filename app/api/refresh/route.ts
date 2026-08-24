import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/collect";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Delta-Refresh: pulls the window since each creator's lastCheckedAt, logs the run, catches up missing covers. */
export async function POST() {
  return NextResponse.json(await runRefresh());
}
