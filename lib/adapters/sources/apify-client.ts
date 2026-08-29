import { APIFY_USD_PER_COMPUTE_UNIT } from "../../config.ts";
import { usageFromActorRun, type ActorUsage } from "../../run-cost.ts";

const APIFY_BASE = "https://api.apify.com/v2";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
/** Longest one poll may hang on the server; the API caps waitForFinish at 60 s. */
const WAIT_FOR_FINISH_S = 60;
/** Time past the actor's own timeout allowed for the last poll and the dataset read. */
const GRACE_MS = 90_000;

export function apifyConfigured() {
  return Boolean(process.env.APIFY_TOKEN);
}

/** Dataset items of one actor run plus what the run cost. */
export type ActorResult<T> = { items: T[]; usage: ActorUsage };

/**
 * The fields of the Apify Run object the client reads. usageTotalUsd is what the
 * account actually pays (compute units and/or pay-per-event), stats.computeUnits
 * the platform usage behind it.
 */
export type ApifyRun = {
  id?: string;
  status?: string;
  defaultDatasetId?: string;
  stats?: { computeUnits?: number };
  usageTotalUsd?: number | null;
};

export type RunActorOptions = {
  timeoutMs?: number;
  /** Test seam: the fetch the client uses for every call. */
  fetch?: typeof fetch;
};

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

async function fail(actorId: string, response: Response): Promise<never> {
  const text = await response.text().catch(() => "");
  throw new Error(`Apify ${actorId} failed (${response.status}): ${text.slice(0, 300)}`);
}

async function readRun(actorId: string, response: Response): Promise<ApifyRun> {
  if (!response.ok) await fail(actorId, response);
  const body = (await response.json().catch(() => ({}))) as { data?: unknown };
  const data = body && typeof body === "object" ? body.data : undefined;
  return data && typeof data === "object" ? (data as ApifyRun) : {};
}

/**
 * Starts an actor, waits for it to finish, and returns its dataset items with
 * the run's usage. The Run object is the only place Apify reports compute units
 * and the dollar total (the run-sync endpoints return the OUTPUT record, not the
 * run), so the client starts the run with waitForFinish, polls the run until it
 * reaches a terminal status, and then reads the default dataset.
 * actorId uses "~" instead of "/" (e.g. "apify~instagram-scraper").
 */
export async function runActor<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  { timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchImpl = fetch }: RunActorOptions = {},
): Promise<ActorResult<T>> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + GRACE_MS);
  const auth = `token=${encodeURIComponent(token)}`;
  const wait = `waitForFinish=${WAIT_FOR_FINISH_S}`;
  const id = actorId.replace("/", "~");

  try {
    const started = await fetchImpl(`${APIFY_BASE}/acts/${id}/runs?${auth}&timeout=${Math.floor(timeoutMs / 1000)}&${wait}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    let run = await readRun(actorId, started);
    if (!run.id) throw new Error(`Apify ${actorId} returned no run id`);

    while (!run.status || !TERMINAL.has(run.status)) {
      if (controller.signal.aborted) throw new Error(`Apify ${actorId} did not finish within ${Math.round(timeoutMs / 1000)} s`);
      run = await readRun(actorId, await fetchImpl(`${APIFY_BASE}/actor-runs/${run.id}?${auth}&${wait}`, { signal: controller.signal }));
    }
    if (run.status !== "SUCCEEDED") throw new Error(`Apify ${actorId} ended ${run.status}`);
    if (!run.defaultDatasetId) throw new Error(`Apify ${actorId} returned no dataset`);

    const itemsResponse = await fetchImpl(`${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?${auth}&clean=true`, { signal: controller.signal });
    if (!itemsResponse.ok) await fail(actorId, itemsResponse);
    const items = (await itemsResponse.json()) as T[];
    return { items: Array.isArray(items) ? items : [], usage: usageFromActorRun(run, APIFY_USD_PER_COMPUTE_UNIT) };
  } finally {
    clearTimeout(timer);
  }
}
