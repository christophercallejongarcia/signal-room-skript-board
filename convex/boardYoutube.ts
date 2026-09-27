import { v } from "convex/values";
import { LIMITS, utf8Bytes } from "../lib/board/limits";
import { sha256Hex } from "../lib/board/youtube";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { assertWritable, boardError, requireToken } from "./boardAuth";
import { transcriptStatusValidator } from "./boardSchema";

/**
 * YouTube source cache per video ID (PLAN.md points 19, 68, 70).
 *
 * `claim` sets `pending` with a new claimId and a 3 minute expiry; an expired
 * claim may be taken again. Chunks are written under `versionId = claimId`.
 * `publish` checks claim, chunk count, size and hash and switches
 * `activeVersion` and `ready` in one mutation. Readers only ever read the
 * active version, so a late old worker can only fill its own, never published version.
 */

export const CLAIM_MS = 3 * 60_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_CHUNKS = Math.ceil(LIMITS.transcriptVersionBytes / LIMITS.transcriptChunkBytes) + 1;

const metaValidator = v.object({
  title: v.optional(v.string()),
  channelTitle: v.optional(v.string()),
  channelId: v.optional(v.string()),
  views: v.optional(v.number()),
  publishedAt: v.optional(v.string()),
  durationSec: v.optional(v.number()),
  thumbnailUrl: v.optional(v.string()),
  language: v.optional(v.string()),
  channelMedianViews: v.optional(v.number()),
  outlier: v.optional(v.number()),
});

export const sourceView = v.object({
  videoId: v.string(),
  url: v.string(),
  title: v.optional(v.string()),
  channelTitle: v.optional(v.string()),
  channelId: v.optional(v.string()),
  views: v.optional(v.number()),
  publishedAt: v.optional(v.string()),
  durationSec: v.optional(v.number()),
  thumbnailUrl: v.optional(v.string()),
  channelMedianViews: v.optional(v.number()),
  outlier: v.optional(v.number()),
  transcriptStatus: transcriptStatusValidator,
  claimExpiresAt: v.optional(v.number()),
  activeVersion: v.optional(v.object({ versionId: v.string(), hash: v.string(), chars: v.number(), source: v.string() })),
  attempts: v.number(),
  error: v.optional(v.string()),
  fetchedAt: v.optional(v.number()),
});

function view(source: Doc<"youtubeSources">) {
  return {
    videoId: source.videoId,
    url: source.url,
    title: source.title,
    channelTitle: source.channelTitle,
    channelId: source.channelId,
    views: source.views,
    publishedAt: source.publishedAt,
    durationSec: source.durationSec,
    thumbnailUrl: source.thumbnailUrl,
    channelMedianViews: source.channelMedianViews,
    outlier: source.outlier,
    transcriptStatus: source.transcriptStatus,
    claimExpiresAt: source.claim?.expiresAt,
    activeVersion: source.activeVersion,
    attempts: source.attempts,
    error: source.error,
    fetchedAt: source.fetchedAt,
  };
}

async function sourceOf(ctx: QueryCtx | MutationCtx, videoId: string) {
  if (!VIDEO_ID.test(videoId)) throw boardError("invalid", "Ungültige Video-ID.");
  return ctx.db
    .query("youtubeSources")
    .withIndex("by_videoId", (q) => q.eq("videoId", videoId))
    .unique();
}

export const getSources = query({
  args: { token: v.string(), videoIds: v.array(v.string()) },
  returns: v.array(sourceView),
  handler: async (ctx, args) => {
    requireToken(args.token);
    if (args.videoIds.length > LIMITS.nodesPerBoard) throw boardError("invalid", "Zu viele Videos angefragt.");
    const out = [];
    for (const videoId of args.videoIds) {
      const source = await sourceOf(ctx, videoId);
      if (source) out.push(view(source));
    }
    return out;
  },
});

/**
 * Start or join an ingest. `ready` and a live `pending` need no new work.
 * `retry` also re-claims `fetch-failed` (the "Erneut versuchen" button).
 */
export const claim = mutation({
  args: { token: v.string(), opsVersion: v.number(), videoId: v.string(), retry: v.boolean() },
  returns: v.object({ action: v.union(v.literal("ready"), v.literal("pending"), v.literal("claimed"), v.literal("blocked")), claimId: v.optional(v.string()), status: transcriptStatusValidator }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "new" });
    const now = Date.now();
    const source = await sourceOf(ctx, args.videoId);
    const claimId = `claim-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const claimDoc = { claimId, expiresAt: now + CLAIM_MS };
    if (!source) {
      await ctx.db.insert("youtubeSources", {
        videoId: args.videoId,
        url: `https://www.youtube.com/watch?v=${args.videoId}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${args.videoId}/hqdefault.jpg`,
        transcriptStatus: "pending",
        claim: claimDoc,
        attempts: 1,
        updatedAt: now,
      });
      return { action: "claimed" as const, claimId, status: "pending" as const };
    }
    const status = source.transcriptStatus;
    if (status === "ready") return { action: "ready" as const, status };
    const claimLive = source.claim !== undefined && source.claim.expiresAt > now;
    if ((status === "pending" || status === "apify-pending") && claimLive) return { action: "pending" as const, status };
    const expiredPending = status === "pending" && !claimLive;
    if (!expiredPending && !(args.retry && status === "fetch-failed")) return { action: "blocked" as const, status };
    await ctx.db.patch("youtubeSources", source._id, { transcriptStatus: "pending", claim: claimDoc, attempts: source.attempts + 1, error: undefined, updatedAt: now });
    return { action: "claimed" as const, claimId, status: "pending" as const };
  },
});

/** One chunk of the claim's own version. Allowed while draining (finishing work already running). */
export const writeChunk = mutation({
  args: { token: v.string(), opsVersion: v.number(), videoId: v.string(), versionId: v.string(), index: v.number(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "finish" });
    if (!Number.isInteger(args.index) || args.index < 0 || args.index >= MAX_CHUNKS) throw boardError("invalid", "Ungültiger Chunk.");
    if (utf8Bytes(args.text) > LIMITS.transcriptChunkBytes) throw boardError("too-large", "Chunk ist zu groß.");
    const source = await sourceOf(ctx, args.videoId);
    if (!source) throw boardError("not-found", "Quelle unbekannt.");
    if (source.activeVersion?.versionId === args.versionId) throw boardError("conflict", "Veröffentlichte Versionen sind unveränderlich.");
    const existing = await ctx.db
      .query("youtubeTranscriptChunks")
      .withIndex("by_videoId_and_versionId_and_index", (q) => q.eq("videoId", args.videoId).eq("versionId", args.versionId).eq("index", args.index))
      .unique();
    if (existing) await ctx.db.patch("youtubeTranscriptChunks", existing._id, { text: args.text });
    else await ctx.db.insert("youtubeTranscriptChunks", { videoId: args.videoId, versionId: args.versionId, index: args.index, text: args.text });
    return null;
  },
});

async function readVersion(ctx: QueryCtx | MutationCtx, videoId: string, versionId: string) {
  return ctx.db
    .query("youtubeTranscriptChunks")
    .withIndex("by_videoId_and_versionId_and_index", (q) => q.eq("videoId", videoId).eq("versionId", versionId))
    .take(MAX_CHUNKS + 1);
}

const metaPatch = (meta: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(meta ?? {}).filter(([, value]) => value !== undefined));

/** Atomically make the claim's version the active one (point 68). */
export const publish = mutation({
  args: { token: v.string(), opsVersion: v.number(), videoId: v.string(), claimId: v.string(), chunkCount: v.number(), hash: v.string(), chars: v.number(), source: v.string(), meta: v.optional(metaValidator) },
  returns: v.object({ published: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "finish" });
    const source = await sourceOf(ctx, args.videoId);
    if (!source || source.claim?.claimId !== args.claimId) return { published: false, reason: "Claim gehört nicht mehr diesem Lauf." };
    const chunks = await readVersion(ctx, args.videoId, args.claimId);
    if (chunks.length !== args.chunkCount || chunks.some((chunk, index) => chunk.index !== index)) return { published: false, reason: "Chunks unvollständig." };
    const text = chunks.map((chunk) => chunk.text).join("");
    if (utf8Bytes(text) > LIMITS.transcriptVersionBytes) return { published: false, reason: "Transkript größer als 2 MB." };
    if ((await sha256Hex(text)) !== args.hash) return { published: false, reason: "Hash passt nicht." };
    const now = Date.now();
    await ctx.db.patch("youtubeSources", source._id, {
      ...metaPatch(args.meta),
      transcriptStatus: "ready",
      activeVersion: { versionId: args.claimId, hash: args.hash, chars: args.chars, source: args.source },
      claim: undefined,
      error: undefined,
      fetchedAt: now,
      updatedAt: now,
    });
    return { published: true };
  },
});

/** End a claim without a transcript: `no-captions`, `fetch-failed` or an Apify outcome. Only with the matching claim. */
export const finish = mutation({
  args: {
    token: v.string(),
    opsVersion: v.number(),
    videoId: v.string(),
    claimId: v.string(),
    status: v.union(v.literal("no-captions"), v.literal("fetch-failed"), v.literal("apify-failed"), v.literal("apify-unknown")),
    error: v.optional(v.string()),
    meta: v.optional(metaValidator),
  },
  returns: v.object({ finished: v.boolean() }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "finish" });
    const source = await sourceOf(ctx, args.videoId);
    if (!source || source.claim?.claimId !== args.claimId) return { finished: false };
    await ctx.db.patch("youtubeSources", source._id, { ...metaPatch(args.meta), transcriptStatus: args.status, claim: undefined, error: args.error?.slice(0, 300), updatedAt: Date.now() });
    return { finished: true };
  },
});

/** Metadata can arrive without a transcript (e.g. the channel median later). */
export const updateMeta = mutation({
  args: { token: v.string(), opsVersion: v.number(), videoId: v.string(), meta: metaValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "finish" });
    const source = await sourceOf(ctx, args.videoId);
    if (source) await ctx.db.patch("youtubeSources", source._id, { ...metaPatch(args.meta), updatedAt: Date.now() });
    return null;
  },
});

/** Full text of one transcript version (at most 2 MB), for copy, context and export. */
export const getTranscript = query({
  args: { token: v.string(), videoId: v.string(), versionId: v.optional(v.string()) },
  returns: v.union(v.null(), v.object({ versionId: v.string(), text: v.string(), hash: v.string() })),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const source = await sourceOf(ctx, args.videoId);
    const versionId = args.versionId ?? source?.activeVersion?.versionId;
    if (!source || !versionId) return null;
    const chunks = await readVersion(ctx, args.videoId, versionId);
    if (chunks.length === 0) return null;
    const text = chunks.map((chunk) => chunk.text).join("");
    return { versionId, text, hash: versionId === source.activeVersion?.versionId ? source.activeVersion.hash : await sha256Hex(text) };
  },
});

export const getChannel = query({
  args: { token: v.string(), channelId: v.string() },
  returns: v.union(v.null(), v.object({ medianViews: v.number(), sampleSize: v.number(), fetchedAt: v.number() })),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const row = await ctx.db
      .query("youtubeChannels")
      .withIndex("by_channelId", (q) => q.eq("channelId", args.channelId))
      .unique();
    return row ? { medianViews: row.medianViews, sampleSize: row.sampleSize, fetchedAt: row.fetchedAt } : null;
  },
});

export const setChannel = mutation({
  args: { token: v.string(), opsVersion: v.number(), channelId: v.string(), medianViews: v.number(), sampleSize: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "finish" });
    const row = await ctx.db
      .query("youtubeChannels")
      .withIndex("by_channelId", (q) => q.eq("channelId", args.channelId))
      .unique();
    const doc = { channelId: args.channelId, medianViews: args.medianViews, sampleSize: args.sampleSize, fetchedAt: Date.now() };
    if (row) await ctx.db.patch("youtubeChannels", row._id, doc);
    else await ctx.db.insert("youtubeChannels", doc);
    return null;
  },
});
