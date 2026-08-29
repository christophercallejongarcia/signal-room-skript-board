import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { monthUsage } from "@/lib/run-cost";

export const runtime = "nodejs";

/** Runs the month total is summed over. Bounded by the storage adapters at 100. */
const MONTH_WINDOW = 100;

/** The last ten runs, newest first, plus the running month's Apify total, for the Profile tab. */
export async function GET() {
  const runs = await getStorage().listRuns(MONTH_WINDOW);
  return NextResponse.json({ runs: runs.slice(0, 10), month: monthUsage(runs, new Date()) });
}
