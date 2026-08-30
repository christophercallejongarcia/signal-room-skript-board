import { STRATEGY_AUDIENCE, STRATEGY_BRIDGE_URL, STRATEGY_GOAL } from "./config.ts";
import { getStorage } from "./adapters/storage/index.ts";
import { withCoverUrls } from "./adapters/storage/cover-cache.ts";
import { applyAngles, briefingPacket, buildBriefing } from "./briefing.ts";
import type { Briefing, BriefingItem, StorageAdapter } from "./contracts";

export type BriefingDeps = {
  storage: Pick<StorageAdapter, "listCreators" | "listSignals" | "saveBriefing">;
  /** Decorates the corpus with cover routes; the cron has no disk and passes the corpus through. */
  withCovers: typeof withCoverUrls;
  /** False skips the Bridge: the cron runs where no Bridge is reachable and writes the list without angles. */
  angles: boolean;
};

/** The bridge gives up on a Codex turn after 120 s; this is the same ceiling from the caller's side. */
export const BRIDGE_TIMEOUT_MS = 120_000;

/** One angle per item, in the order of the items. Throws when the Bridge is unhappy. */
async function askBridge(items: BriefingItem[]) {
  const response = await fetch(`${STRATEGY_BRIDGE_URL}/v1/briefing`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: STRATEGY_GOAL, audience: STRATEGY_AUDIENCE, evidence: briefingPacket(items) }),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `The bridge answered with HTTP ${response.status}.`);
  }
  return response.json();
}

/**
 * One daily Briefing over the stored corpus: rank, ask the Bridge for the angles,
 * store the document under the day. The angles are the only part that can fail,
 * and a failure leaves the briefing standing without them, which is the point of
 * hanging them on afterwards. The route after a refresh and POST /api/briefings
 * are the two callers, so the automatic pass and the manual one cannot drift.
 */
export async function runBriefing(overrides: Partial<BriefingDeps> = {}): Promise<Briefing> {
  const storage = overrides.storage ?? getStorage();
  const withCovers = overrides.withCovers ?? withCoverUrls;
  const angles = overrides.angles ?? true;
  const [creators, signals] = await Promise.all([storage.listCreators(), storage.listSignals()]);
  // Covers live on disk, not in the corpus. Decorated here, so a stored briefing
  // carries the cover route for every reel whose file was already cached; a cover
  // that arrives later shows up on the next day's briefing, not on this document.
  const briefing = buildBriefing(await withCovers(signals), creators, { now: Date.now() });

  let angled = briefing;
  if (angles && briefing.items.length > 0) {
    try {
      angled = applyAngles(briefing, await askBridge(briefing.items));
    } catch (error) {
      // The briefing is the document, the angle is the garnish. A Bridge that is
      // down or logged out costs the angles, never the morning's list.
      console.error("Briefing angles failed:", error instanceof Error ? error.message : error);
    }
  }

  await storage.saveBriefing(angled);
  return angled;
}
