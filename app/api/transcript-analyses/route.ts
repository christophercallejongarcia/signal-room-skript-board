import { NextResponse } from "next/server.js";
import { getStorage } from "../../../lib/adapters/storage/index.ts";
import { enqueueTranscriptAnalyses, processTranscriptAnalyses, TranscriptAnalysisRequestError } from "../../../lib/transcript-analysis-run.ts";
import { parseTranscriptAnalysisAction } from "../../../lib/transcript-analysis.ts";

export const runtime = "nodejs";
export const maxDuration = 180;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: Request) {
  const signalId = new URL(request.url).searchParams.get("signalId")?.trim();
  if (!signalId) return NextResponse.json({ error: "signalId is required." }, { status: 400 });
  const analyses = await getStorage().listTranscriptAnalyses({ signalId, limit: 20 });
  return NextResponse.json({ analyses });
}

/** Queue commands stay cheap; only an explicit local run/process command calls the Bridge. */
export async function POST(request: Request) {
  let action: ReturnType<typeof parseTranscriptAnalysisAction>;
  try {
    action = parseTranscriptAnalysisAction(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
  const storage = getStorage();
  try {
    if (action.action === "catch-up") {
      return NextResponse.json(await enqueueTranscriptAnalyses(storage, { limit: action.limit, cursor: action.cursor }));
    }
    if (action.action === "process") {
      return NextResponse.json(await processTranscriptAnalyses({ storage, limit: action.limit }));
    }
    if (action.action === "retry") {
      const analysis = await storage.retryTranscriptAnalysis(action.analysisId, new Date().toISOString());
      if (!analysis) return NextResponse.json({ error: `unknown analysis ${action.analysisId}` }, { status: 404 });
      await processTranscriptAnalyses({ storage, limit: 1, analysisId: analysis.id });
      return NextResponse.json({ analyses: await storage.listTranscriptAnalyses({ signalId: analysis.signalId, limit: 20 }) });
    }

    const analysis = await storage.enqueueTranscriptAnalysis(action.signalId, new Date().toISOString());
    if (!analysis) return NextResponse.json({ error: `unknown or unfinished Reel ${action.signalId}` }, { status: 409 });
    await processTranscriptAnalyses({ storage, limit: 1, analysisId: analysis.id });
    return NextResponse.json({ analyses: await storage.listTranscriptAnalyses({ signalId: action.signalId, limit: 20 }) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: error instanceof TranscriptAnalysisRequestError ? 400 : 502 });
  }
}
