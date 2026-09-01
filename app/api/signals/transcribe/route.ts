import { NextResponse } from "next/server";
import { withCoverUrls } from "@/lib/adapters/storage/cover-cache";
import { runTranscript, TranscriptRequestError, TranscriptRunError } from "@/lib/transcript-run";
import { parseTranscriptRequest, TranscriptConflictError } from "@/lib/transcripts";

export const runtime = "nodejs";
/** The Apify client waits for the actor and has its own bounded timeout. */
export const maxDuration = 300;

/** Starts one transcript attempt for one Reel and returns the updated Signal. */
export async function POST(request: Request) {
  let id: string;
  try {
    id = parseTranscriptRequest(await request.json().catch(() => ({}))).id;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  try {
    const result = await runTranscript(id);
    if (!result) return NextResponse.json({ error: `unknown signal ${id}` }, { status: 404 });
    const [signal] = await withCoverUrls([result.signal]);
    return NextResponse.json({ signal, run: result.run });
  } catch (error) {
    if (error instanceof TranscriptConflictError) {
      return NextResponse.json({ error: error.message, reason: error.reason }, { status: 409 });
    }
    if (error instanceof TranscriptRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof TranscriptRunError) {
      const [signal] = await withCoverUrls([error.signal]);
      return NextResponse.json({ error: error.message, signal, run: error.run }, { status: 502 });
    }
    // Keep actor or storage internals out of the response shape beyond the bounded cause we store on the Signal.
    return NextResponse.json({ error: "The transcript run failed." }, { status: 502 });
  }
}
