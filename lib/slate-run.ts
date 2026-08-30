import { SLATE_SIZE, STRATEGY_AUDIENCE, STRATEGY_BRIDGE_URL, STRATEGY_GOAL } from "./config.ts";
import { getStorage } from "./adapters/storage/index.ts";
import { briefingPacket } from "./briefing.ts";
import { BRIDGE_TIMEOUT_MS } from "./briefing-run.ts";
import type { Slate, SlateRequest, StorageAdapter } from "./contracts";
import { SlateRefusal, newSlate, parseSlateAnswer, replaceStart, requireStart, slateId, slateSources, type SlateSource } from "./slate.ts";

export type SlateDeps = {
  storage: Pick<StorageAdapter, "listCreators" | "listSignals" | "listSlates" | "saveSlate">;
  /** Epoch ms the run is measured from. */
  now: number;
};

/** One of the stored slates by id, or null. The routes and the regenerate run look a slate up the same way. */
export async function findSlate(storage: Pick<StorageAdapter, "listSlates">, id: string) {
  return (await storage.listSlates()).find((slate) => slate.id === id) ?? null;
}

/** The starts the Bridge wrote for the packet. Throws when the Bridge is unhappy or the answer does not fit. */
async function askBridge(request: Omit<SlateRequest, "goal" | "audience">, sources: SlateSource[]) {
  const response = await fetch(`${STRATEGY_BRIDGE_URL}/v1/slate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: STRATEGY_GOAL, audience: STRATEGY_AUDIENCE, ...request }),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `The bridge answered with HTTP ${response.status}.`);
  }
  return parseSlateAnswer(await response.json(), sources, request.count);
}

function resolve(overrides: Partial<SlateDeps>): SlateDeps {
  return { storage: overrides.storage ?? getStorage(), now: overrides.now ?? Date.now() };
}

/** The Reels of the window measured from the given moment, and the packet the Bridge reads. */
async function sourcesAt(storage: SlateDeps["storage"], now: number) {
  const [creators, signals] = await Promise.all([storage.listCreators(), storage.listSignals()]);
  const sources = slateSources(signals, creators, { now });
  return { sources, evidence: briefingPacket(sources) };
}

/**
 * The day's Slate. A slate that already exists for the day is handed back as it
 * is, so the second refresh of a morning never wipes out a regenerated start or
 * an Idea the first one led to; force is the one way past that. The direction
 * comes from the newest slate, today's or yesterday's, which is how "for the
 * next run" is kept: typed once, applied until changed. Unlike an angle, the
 * slate is the document itself, so a Bridge that fails writes nothing.
 */
export async function runSlate(overrides: Partial<SlateDeps> & { force?: boolean } = {}): Promise<Slate> {
  const { storage, now } = resolve(overrides);
  const force = overrides.force ?? false;
  const id = slateId(now);
  const [latest] = await storage.listSlates(1);
  if (latest?.id === id && !force) return latest;
  const direction = latest?.direction;

  const { sources, evidence } = await sourcesAt(storage, now);
  const starts =
    sources.length === 0
      ? []
      : await askBridge({ ...(direction ? { direction } : {}), count: SLATE_SIZE, evidence }, sources);

  const slate = newSlate({ id, now, sources: sources.length, starts, ...(direction ? { direction } : {}) });
  await storage.saveSlate(slate);
  return slate;
}

/**
 * Writes one position anew and leaves the other nine as they are. The packet is
 * read from the window the slate was composed for, the other pitches travel as
 * taken so the new one is not one of them, and the direction on the slate is
 * the direction of this run. Null when no slate has that id.
 */
export async function regenerateStart(id: string, position: number, overrides: Partial<SlateDeps> = {}): Promise<Slate | null> {
  const { storage, now } = resolve(overrides);
  const slate = await findSlate(storage, id);
  if (!slate) return null;
  requireStart(slate, position);

  const { sources, evidence } = await sourcesAt(storage, Date.parse(slate.generatedAt));
  if (sources.length === 0) throw new SlateRefusal("The window of this slate holds no reel any more.");
  const taken = slate.starts.filter((start) => start.position !== position).map((start) => start.pitch);
  const [start] = await askBridge(
    { ...(slate.direction ? { direction: slate.direction } : {}), count: 1, taken, evidence },
    sources,
  );

  const next = replaceStart(slate, position, start, now);
  await storage.saveSlate(next);
  return next;
}
