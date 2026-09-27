import { BoardApiError, boardConvex } from "./server.ts";
import { OPS_VERSION } from "./versions.ts";
import { writeTranscriptVersion } from "./youtube-ingest.ts";

/**
 * Apify transcript fallback (PLAN.md point 70), only on an explicit click and
 * never above BOARD_APIFY_MAX_USD. The run is started without waiting, its
 * actorRunId is stored at once, and a poller finishes it — also after a Next
 * restart, when the next status poll finds a running request nobody watches.
 */
export const APIFY_ACTOR = "codepoetry~youtube-transcript-ai-scraper";
const APIFY_BASE = "https://api.apify.com/v2";
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
const AI_USD_PER_MINUTE = 0.011;
const START_USD = 0.003;

export type ApifyRunState = { id: string; status: string; defaultDatasetId?: string; usageTotalUsd?: number | null };

export type ApifyClient = {
  startRun(input: Record<string, unknown>, maxTotalChargeUsd: number): Promise<ApifyRunState>;
  getRun(runId: string): Promise<ApifyRunState>;
  getItems(datasetId: string): Promise<Record<string, unknown>[]>;
};

export function apifyMaxUsd(): number {
  const value = Number(process.env.BOARD_APIFY_MAX_USD ?? "0.05");
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : 0.05;
}

export function apifyEnabled(): boolean {
  return Boolean(process.env.APIFY_TOKEN?.trim());
}

/** Actor input: German before English captions, AI transcription only within the price cap. */
export function apifyInput(videoId: string, maxUsd: number) {
  return {
    startUrls: [{ url: `https://www.youtube.com/watch?v=${videoId}` }],
    languages: ["de", "en"],
    subType: "both",
    enableAiFallback: true,
    maxAiMinutes: Math.max(1, Math.floor((maxUsd - START_USD) / AI_USD_PER_MINUTE)),
    useAnyAvailableCaptionLanguage: true,
    machineTranslateCaptions: false,
    outputFormats: ["text"],
    maxResults: 1,
  };
}

/** The transcript text from one dataset item, whatever field the actor used. */
export function transcriptFromItem(item: Record<string, unknown>): string | null {
  for (const key of ["transcript_text", "text", "plain_text", "transcript", "transcript_llm", "llm_text"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const segments = item.transcript_json;
  if (Array.isArray(segments)) {
    const text = segments.map((segment) => (segment && typeof segment === "object" ? String((segment as { text?: unknown }).text ?? "") : "")).join(" ").trim();
    if (text) return text;
  }
  return null;
}

export function httpApifyClient(fetchImpl: typeof fetch = fetch): ApifyClient {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new BoardApiError(503, "apify-off", "Apify ist nicht eingerichtet (APIFY_TOKEN fehlt).");
  const auth = `token=${encodeURIComponent(token)}`;
  const data = async (response: Response) => {
    if (!response.ok) throw new Error(`Apify ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
    return ((await response.json()) as { data: unknown }).data;
  };
  return {
    async startRun(input, maxTotalChargeUsd) {
      const response = await fetchImpl(`${APIFY_BASE}/acts/${APIFY_ACTOR}/runs?${auth}&maxTotalChargeUsd=${maxTotalChargeUsd}&timeout=600`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      return (await data(response)) as ApifyRunState;
    },
    async getRun(runId) {
      return (await data(await fetchImpl(`${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}?${auth}&waitForFinish=30`))) as ApifyRunState;
    },
    async getItems(datasetId) {
      const response = await fetchImpl(`${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items?${auth}&clean=true&limit=5`);
      if (!response.ok) throw new Error(`Apify-Dataset ${response.status}`);
      return (await response.json()) as Record<string, unknown>[];
    },
  };
}

type Convex = ReturnType<typeof boardConvex>;
type Request = { requestId: string; videoId: string; claimId: string; approvedUsd: number; actorRunId?: string; status: string; startedAt: number };

const globalPollers = globalThis as typeof globalThis & { __boardApifyPollers?: Set<string> };
function pollers() {
  globalPollers.__boardApifyPollers ??= new Set();
  return globalPollers.__boardApifyPollers;
}

/** Follow one run to its end and publish the transcript under the request's claim. */
export async function pollApifyRun(request: Request, deps: { convex: Convex; client: ApifyClient; sleep?: (ms: number) => Promise<void>; deadlineMs?: number }) {
  const { convex, client } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (!request.actorRunId || pollers().has(request.requestId)) return;
  pollers().add(request.requestId);
  try {
    const deadline = Date.now() + (deps.deadlineMs ?? 15 * 60_000);
    let run = await client.getRun(request.actorRunId);
    while (!TERMINAL.has(run.status) && Date.now() < deadline) {
      await sleep(3_000);
      run = await client.getRun(request.actorRunId);
    }
    const costUsd = typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : undefined;
    if (run.status !== "SUCCEEDED" || !run.defaultDatasetId) {
      await convex.mutation("boardApify:finish", { opsVersion: OPS_VERSION, requestId: request.requestId, status: "failed", costUsd, error: `Apify-Run ${run.status}.` });
      return;
    }
    const text = (await client.getItems(run.defaultDatasetId)).map(transcriptFromItem).find(Boolean);
    if (!text) {
      await convex.mutation("boardApify:finish", { opsVersion: OPS_VERSION, requestId: request.requestId, status: "failed", costUsd, error: "Apify fand kein Transkript (Video zu lang für den Höchstbetrag?)." });
      return;
    }
    const written = await writeTranscriptVersion(convex, request.videoId, request.claimId, text);
    await convex.mutation("boardYoutube:publish", { opsVersion: OPS_VERSION, videoId: request.videoId, claimId: request.claimId, ...written, source: "apify" });
    await convex.mutation("boardApify:finish", { opsVersion: OPS_VERSION, requestId: request.requestId, status: "succeeded", costUsd });
  } finally {
    pollers().delete(request.requestId);
  }
}

/** The click on "Transkript über Apify holen": idempotent per requestId. */
export async function startApify(videoId: string, requestId: string, deps: { convex?: Convex; client?: ApifyClient; background?: (task: Promise<unknown>) => void; poll?: boolean } = {}) {
  const convex = deps.convex ?? boardConvex();
  const client = deps.client ?? httpApifyClient();
  const maxUsd = apifyMaxUsd();
  const result = await convex.mutation<{ action: "created" | "existing" | "busy" | "refused"; request?: Request; reason?: string }>("boardApify:start", { opsVersion: OPS_VERSION, requestId, videoId, approvedUsd: maxUsd });
  if (result.action === "refused") throw new BoardApiError(409, "conflict", result.reason ?? "Apify-Abruf abgelehnt.");
  if (result.action !== "created" || !result.request) return { action: result.action, request: result.request };
  const run = await client.startRun(apifyInput(videoId, maxUsd), maxUsd);
  await convex.mutation("boardApify:setActorRun", { opsVersion: OPS_VERSION, requestId, actorRunId: run.id });
  if (deps.poll !== false) {
    const task = pollApifyRun({ ...result.request, actorRunId: run.id }, { convex, client }).catch(() => {});
    (deps.background ?? ((promise) => void promise))(task);
  }
  return { action: "created" as const, request: { ...result.request, actorRunId: run.id } };
}

/** On every status poll: turn stale starts into `unknown`, pick up running requests nobody watches. */
export async function resumeApify(videoId: string, deps: { convex?: Convex; client?: () => ApifyClient } = {}) {
  const convex = deps.convex ?? boardConvex();
  const requests = await convex.mutation<Request[]>("boardApify:reconcile", { opsVersion: OPS_VERSION, videoId });
  for (const request of requests) {
    if (request.status === "running" && request.actorRunId && !pollers().has(request.requestId) && apifyEnabled()) {
      void pollApifyRun(request, { convex, client: (deps.client ?? httpApifyClient)() }).catch(() => {});
    }
  }
}
