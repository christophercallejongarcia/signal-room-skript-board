import { NextResponse } from "next/server";
import { outlierScorer } from "@/lib/adapters/scoring/outlier";
import { getStorage } from "@/lib/adapters/storage";
import {
  OUTLIER_THRESHOLD,
  STRATEGY_AUDIENCE,
  STRATEGY_BRIDGE_URL,
  STRATEGY_EVIDENCE_WINDOW_DAYS,
  STRATEGY_GOAL,
} from "@/lib/config";
import type { Forecast, Storyboard, StoryboardRequest } from "@/lib/contracts";
import { parseForecastAnswer } from "@/lib/forecast";
import { parseStoryboard } from "@/lib/ideas";
import { selectEvidence } from "@/lib/strategy-evidence";

export const runtime = "nodejs";
/** One Codex turn through the bridge; the bridge itself gives up after 120 s. */
export const maxDuration = 300;


/**
 * The storyboard is the contract; the forecast rides along. An answer without a
 * usable forecast field still yields the storyboard, and the idea carries none.
 */
async function askBridge(request: StoryboardRequest): Promise<{ storyboard: Storyboard; forecast: Forecast | null }> {
  const response = await fetch(`${STRATEGY_BRIDGE_URL}/v1/storyboard`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `The bridge answered with HTTP ${response.status}.`);
  }
  const answer: unknown = await response.json();
  return { storyboard: parseStoryboard(answer), forecast: parseForecastAnswer(answer, request.evidence) };
}

/**
 * Develop: evidence packet plus idea to the bridge, storyboard back onto the idea.
 * The run id claimed here is the collision guard; a newer run makes this one stale.
 */
export async function POST(request: Request) {
  const { ideaId } = (await request.json().catch(() => ({}))) as { ideaId?: string };
  if (!ideaId) return NextResponse.json({ error: "ideaId required" }, { status: 400 });

  const storage = getStorage();
  const [signals, creators] = await Promise.all([storage.listSignals(), storage.listCreators()]);
  const evidence = selectEvidence(outlierScorer.rank(signals, creators), creators, { now: Date.now() });
  if (evidence.length === 0) {
    return NextResponse.json(
      {
        error: `No reel above ${OUTLIER_THRESHOLD}x outlier in the last ${STRATEGY_EVIDENCE_WINDOW_DAYS} days. Refresh, then try again.`,
      },
      { status: 409 },
    );
  }

  const runId = crypto.randomUUID();
  let claimed;
  try {
    claimed = await storage.claimIdeaDevelop(ideaId, runId, new Date().toISOString());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
  if (!claimed) return NextResponse.json({ error: "No idea with that id." }, { status: 404 });

  try {
    const { storyboard, forecast } = await askBridge({
      goal: STRATEGY_GOAL,
      audience: STRATEGY_AUDIENCE,
      idea: { title: claimed.title, ...(claimed.goal ? { goal: claimed.goal } : {}) },
      evidence,
    });
    const idea = await storage.settleIdeaDevelop(ideaId, runId, {
      storyboard,
      forecast,
      now: new Date().toISOString(),
      evidenceCount: evidence.length,
    });
    // A newer run has taken the claim, so this storyboard is not written.
    if (!idea) return NextResponse.json({ stale: true });
    return NextResponse.json({ idea });
  } catch (error) {
    await storage.settleIdeaDevelop(ideaId, runId, { storyboard: null, now: new Date().toISOString() });
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
