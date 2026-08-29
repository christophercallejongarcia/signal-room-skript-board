import { APIFY_USD_PER_COMPUTE_UNIT } from "../../config.ts";
import { usageFromActorRun, type ActorUsage } from "../../run-cost.ts";

const APIFY_BASE = "https://api.apify.com/v2";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export function apifyConfigured() {
  return Boolean(process.env.APIFY_TOKEN);
}

/** Dataset items of one actor run plus what the run cost. */
export type ActorResult<T> = { items: T[]; usage: ActorUsage };

type ActorRun = { id?: string; status?: string; defaultDatasetId?: string; stats?: { computeUnits?: number }; usageTotalUsd?: number };

async function fail(actorId: string, response: Response): Promise<never> {
  const text = await response.text().catch(() => "");
  throw new Error(`Apify ${actorId} failed (${response.status}): ${text.slice(0, 300)}`);
}

/**
 * Runs an actor synchronously and returns its dataset items with the run's usage.
 * Two calls rather than run-sync-get-dataset-items: only the run object carries
 * compute units and the dollar total, so the cost can be logged on the Run.
 * actorId uses "~" instead of "/" (e.g. "apify~instagram-scraper").
 */
export async function runActor<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<ActorResult<T>> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const auth = `token=${encodeURIComponent(token)}`;
  const runUrl = `${APIFY_BASE}/acts/${actorId.replace("/", "~")}/run-sync?${auth}&timeout=${Math.floor(timeoutMs / 1000)}`;

  try {
    const response = await fetch(runUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok) await fail(actorId, response);
    const run = ((await response.json()) as { data?: ActorRun }).data ?? {};
    if (run.status && run.status !== "SUCCEEDED") throw new Error(`Apify ${actorId} ended ${run.status}`);
    if (!run.defaultDatasetId) throw new Error(`Apify ${actorId} returned no dataset`);

    const itemsResponse = await fetch(`${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?${auth}&clean=true`, { signal: controller.signal });
    if (!itemsResponse.ok) await fail(actorId, itemsResponse);
    const items = (await itemsResponse.json()) as T[];
    return { items: Array.isArray(items) ? items : [], usage: usageFromActorRun(run, APIFY_USD_PER_COMPUTE_UNIT) };
  } finally {
    clearTimeout(timer);
  }
}
