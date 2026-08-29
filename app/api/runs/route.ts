import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { monthUsage } from "@/lib/run-cost";

export const runtime = "nodejs";

/** Newest runs the month total is summed over; both storage adapters stop at 100. */
const MONTH_RUN_CAP = 100;

/**
 * The last ten runs, newest first, plus the running month's Apify total, for the
 * Profile tab. month.truncated flags a month with more runs than the cap.
 */
export async function GET() {
  const runs = await getStorage().listRuns(MONTH_RUN_CAP);
  return NextResponse.json({ runs: runs.slice(0, 10), month: monthUsage(runs, new Date()) });
}
