import { LIMITS } from "./limits.ts";
import { BoardApiError, boardConvex, bridgeFetch } from "./server.ts";
import { OPS_VERSION } from "./versions.ts";
import { chunkText, median, outlierFactor, publishedAtFromUploadDate, sha256Hex, thumbnailFor } from "./youtube.ts";

/**
 * Next side of the YouTube ingest (PLAN.md points 67 to 69a): claim in Convex,
 * fetch through the bridge, write the transcript as chunks of the claim's own
 * version and publish it atomically. The channel median is cached 24 h per channel.
 */

export type SourceView = {
  videoId: string;
  url: string;
  title?: string;
  channelTitle?: string;
  channelId?: string;
  views?: number;
  publishedAt?: string;
  durationSec?: number;
  thumbnailUrl?: string;
  channelMedianViews?: number;
  outlier?: number;
  transcriptStatus: "pending" | "ready" | "no-captions" | "fetch-failed" | "apify-pending" | "apify-unknown" | "apify-failed";
  claimExpiresAt?: number;
  activeVersion?: { versionId: string; hash: string; chars: number; source: string };
  attempts: number;
  error?: string;
  fetchedAt?: number;
};

type BridgeResult = {
  meta: { title?: string; channelTitle?: string; channelId?: string; views?: number; uploadDate?: string; durationSec?: number; language?: string };
  transcript: { text: string; source: string; lang: string } | null;
  noCaptions: boolean;
  channelViews?: number[];
};

const CHANNEL_TTL_MS = 24 * 3_600_000;

export type IngestDeps = {
  convex: ReturnType<typeof boardConvex>;
  fetchBridge(body: { videoId: string; withChannel: boolean }): Promise<{ status: number; data: BridgeResult | { error: string; code?: string }; retryAfter?: string | null }>;
  now(): number;
};

export function defaultIngestDeps(): IngestDeps {
  return {
    convex: boardConvex(),
    async fetchBridge(body) {
      const response = await bridgeFetch("/v1/board/youtube", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), timeoutMs: 200_000 });
      return { status: response.status, data: await response.json(), retryAfter: response.headers.get("retry-after") };
    },
    now: () => Date.now(),
  };
}

export async function writeTranscriptVersion(convex: IngestDeps["convex"], videoId: string, versionId: string, text: string) {
  const chunks = chunkText(text, LIMITS.transcriptChunkBytes);
  for (let index = 0; index < chunks.length; index += 1) {
    await convex.mutation("boardYoutube:writeChunk", { opsVersion: OPS_VERSION, videoId, versionId, index, text: chunks[index] });
  }
  return { chunkCount: chunks.length, hash: await sha256Hex(chunks.join("")), chars: Array.from(text).length };
}

export type IngestOutcome = { status: SourceView["transcriptStatus"] | "queued"; source?: SourceView; message?: string; retryAfter?: number };

export async function ingestYoutube(videoId: string, { retry = false, deps = defaultIngestDeps() }: { retry?: boolean; deps?: IngestDeps } = {}): Promise<IngestOutcome> {
  const { convex } = deps;
  const claim = await convex.mutation<{ action: "ready" | "pending" | "claimed" | "blocked"; claimId?: string; status: SourceView["transcriptStatus"] }>("boardYoutube:claim", { opsVersion: OPS_VERSION, videoId, retry });
  if (claim.action !== "claimed" || !claim.claimId) return { status: claim.status };
  const claimId = claim.claimId;

  let bridge: Awaited<ReturnType<IngestDeps["fetchBridge"]>>;
  try {
    bridge = await deps.fetchBridge({ videoId, withChannel: true });
  } catch (error) {
    await convex.mutation("boardYoutube:finish", { opsVersion: OPS_VERSION, videoId, claimId, status: "fetch-failed", error: "Bridge nicht erreichbar. `npm run dev:board` starten." });
    return { status: "fetch-failed", message: error instanceof Error ? error.message : String(error) };
  }
  if (bridge.status === 429) {
    await convex.mutation("boardYoutube:finish", { opsVersion: OPS_VERSION, videoId, claimId, status: "fetch-failed", error: "Warteschlange voll, gleich erneut." });
    return { status: "queued", message: "Warteschlange voll, gleich erneut.", retryAfter: Number(bridge.retryAfter ?? 5) };
  }
  if (bridge.status !== 200 || !("meta" in bridge.data)) {
    const message = "error" in bridge.data ? bridge.data.error : `HTTP ${bridge.status}`;
    await convex.mutation("boardYoutube:finish", { opsVersion: OPS_VERSION, videoId, claimId, status: "fetch-failed", error: message });
    return { status: "fetch-failed", message };
  }

  const result = bridge.data;
  const meta: Record<string, unknown> = {
    title: result.meta.title,
    channelTitle: result.meta.channelTitle,
    channelId: result.meta.channelId,
    views: result.meta.views,
    publishedAt: publishedAtFromUploadDate(result.meta.uploadDate),
    durationSec: result.meta.durationSec,
    thumbnailUrl: thumbnailFor(videoId),
    language: result.meta.language,
  };
  if (result.meta.channelId) {
    let channelMedian: number | null = null;
    const cached = await convex.query<{ medianViews: number; fetchedAt: number } | null>("boardYoutube:getChannel", { channelId: result.meta.channelId });
    if (cached && deps.now() - cached.fetchedAt < CHANNEL_TTL_MS) channelMedian = cached.medianViews;
    else if (result.channelViews && result.channelViews.length > 0) {
      channelMedian = median(result.channelViews);
      if (channelMedian) await convex.mutation("boardYoutube:setChannel", { opsVersion: OPS_VERSION, channelId: result.meta.channelId, medianViews: channelMedian, sampleSize: result.channelViews.length });
    }
    if (channelMedian) {
      meta.channelMedianViews = channelMedian;
      meta.outlier = outlierFactor(result.meta.views, channelMedian);
    }
  }

  if (!result.transcript) {
    await convex.mutation("boardYoutube:finish", { opsVersion: OPS_VERSION, videoId, claimId, status: "no-captions", meta });
    return { status: "no-captions" };
  }
  const written = await writeTranscriptVersion(convex, videoId, claimId, result.transcript.text);
  const published = await convex.mutation<{ published: boolean; reason?: string }>("boardYoutube:publish", { opsVersion: OPS_VERSION, videoId, claimId, ...written, source: result.transcript.source, meta });
  if (!published.published) throw new BoardApiError(409, "conflict", published.reason ?? "Transkript konnte nicht veröffentlicht werden.");
  return { status: "ready" };
}

export async function sourcesFor(videoIds: string[], convex = boardConvex()): Promise<SourceView[]> {
  if (videoIds.length === 0) return [];
  return convex.query<SourceView[]>("boardYoutube:getSources", { videoIds });
}
