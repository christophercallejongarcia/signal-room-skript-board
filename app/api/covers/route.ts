import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { CoverRunError, runCoverRequest } from "@/lib/cover-run";

export const runtime = "nodejs";

/** Creates or replaces the latest three-package board for one Idea and format. */
export async function POST(request: Request) {
  try {
    const idea = await runCoverRequest(await request.json().catch(() => ({})), getStorage());
    return NextResponse.json({ idea }, { status: 201 });
  } catch (error) {
    const status = error instanceof CoverRunError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The cover run failed." },
      { status },
    );
  }
}
