import { NextResponse } from "next/server";
import { outlierScorer } from "@/lib/adapters/scoring/outlier";
import { getStorage } from "@/lib/adapters/storage";
import {
  HOOK_RUN_HISTORY,
  OUTLIER_THRESHOLD,
  STRATEGY_AUDIENCE,
  STRATEGY_BRIDGE_URL,
  STRATEGY_EVIDENCE_WINDOW_DAYS,
  STRATEGY_GOAL,
} from "@/lib/config";
import type { HookVariant, HooksRequest, StrategyEvidenceItem } from "@/lib/contracts";
import { groupHooks, newHookRun, parseHookBoard, parseHookRequest, type HookRequestInput } from "@/lib/hooks-board";
import { selectEvidence } from "@/lib/strategy-evidence";

export const runtime = "nodejs";
/** One Codex turn through the bridge; the bridge itself gives up after 120 s. */
export const maxDuration = 300;

async function askBridge(request: HooksRequest, evidence: StrategyEvidenceItem[]): Promise<HookVariant[]> {
  const response = await fetch(`${STRATEGY_BRIDGE_URL}/v1/hooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `The bridge answered with HTTP ${response.status}.`);
  }
  return parseHookBoard(await response.json(), evidence);
}

/** The history rail, newest first. */
export async function GET() {
  return NextResponse.json({ runs: await getStorage().listHookRuns(HOOK_RUN_HISTORY) });
}

/**
 * One Hooks-Board run: source material plus the evidence packet to the bridge,
 * grouped variants back. Every run writes its own row, so two runs started in
 * parallel never overwrite each other.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<HookRequestInput>;

  let input: HookRequestInput;
  try {
    // parseHookRequest bounds the body; it is the only place that decides what a run is.
    input = parseHookRequest(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

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

  try {
    const variants = await askBridge(
      {
        goal: STRATEGY_GOAL,
        audience: STRATEGY_AUDIENCE,
        source: input.source,
        ...(input.direction ? { direction: input.direction } : {}),
        count: input.count,
        evidence,
      },
      evidence,
    );
    const run = newHookRun(input, {
      id: `hook-run-${crypto.randomUUID()}`,
      now: new Date().toISOString(),
      groups: groupHooks(variants),
      evidenceCount: evidence.length,
    });
    await storage.saveHookRun(run);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
