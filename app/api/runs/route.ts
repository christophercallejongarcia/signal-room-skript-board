import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";

export const runtime = "nodejs";

/** The last ten runs, newest first, for the Profile tab. */
export async function GET() {
  return NextResponse.json({ runs: await getStorage().listRuns(10) });
}
