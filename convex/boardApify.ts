import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { assertWritable, boardError, readConfig, requireToken } from "./boardAuth";

/**
 * Paid Apify fallback for videos without captions (PLAN.md point 70).
 * One click = one `requestId`; the same requestId is idempotent, a second open
 * request for the same video is refused. `actorRunId` is stored as soon as the
 * run exists. Without it, after 5 minutes the request becomes `unknown`
 * ("möglicherweise schon bezahlt") and nothing buys again without a new click.
 */
export const UNKNOWN_AFTER_MS = 5 * 60_000;
const START_FROM: ReadonlySet<string> = new Set(["no-captions", "fetch-failed", "apify-failed", "apify-unknown"]);

const requestView = v.object({
  requestId: v.string(),
  videoId: v.string(),
  claimId: v.string(),
  approvedUsd: v.number(),
  actorRunId: v.optional(v.string()),
  status: v.union(v.literal("starting"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("unknown")),
  costUsd: v.optional(v.number()),
  startedAt: v.number(),
  updatedAt: v.number(),
});

function view(request: Doc<"apifyRequests">) {
  const { _id, _creationTime, ...rest } = request;
  return rest;
}

async function requestOf(ctx: MutationCtx, requestId: string) {
  return ctx.db
    .query("apifyRequests")
    .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
    .unique();
}

async function openFor(ctx: MutationCtx, videoId: string) {
  const recent = await ctx.db
    .query("apifyRequests")
    .withIndex("by_videoId", (q) => q.eq("videoId", videoId))
    .order("desc")
    .take(20);
  return recent.find((request) => request.status === "starting" || request.status === "running") ?? null;
}

export const start = mutation({
  args: { token: v.string(), opsVersion: v.number(), requestId: v.string(), videoId: v.string(), approvedUsd: v.number() },
  returns: v.object({ action: v.union(v.literal("created"), v.literal("existing"), v.literal("busy"), v.literal("refused")), request: v.optional(requestView), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "new" });
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(args.requestId)) throw boardError("invalid", "Ungültige requestId.");
    if (!(args.approvedUsd > 0 && args.approvedUsd <= 1)) throw boardError("invalid", "Ungültiger Höchstbetrag.");
    const existing = await requestOf(ctx, args.requestId);
    if (existing) return { action: "existing" as const, request: view(existing) };
    if (!(await readConfig(ctx)).apifyEnabled) return { action: "refused" as const, reason: "Apify ist abgeschaltet." };
    const open = await openFor(ctx, args.videoId);
    if (open) return { action: "busy" as const, request: view(open) };
    const source = await ctx.db
      .query("youtubeSources")
      .withIndex("by_videoId", (q) => q.eq("videoId", args.videoId))
      .unique();
    if (!source || !START_FROM.has(source.transcriptStatus)) return { action: "refused" as const, reason: "Für dieses Video ist kein Apify-Abruf nötig." };
    const now = Date.now();
    const claimId = `apify-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await ctx.db.patch("youtubeSources", source._id, { transcriptStatus: "apify-pending", claim: { claimId, expiresAt: now + UNKNOWN_AFTER_MS * 3 }, error: undefined, updatedAt: now });
    await ctx.db.insert("apifyRequests", { requestId: args.requestId, videoId: args.videoId, claimId, approvedUsd: args.approvedUsd, status: "starting", startedAt: now, updatedAt: now });
    const created = await requestOf(ctx, args.requestId);
    return { action: "created" as const, request: view(created!) };
  },
});

export const setActorRun = mutation({
  args: { token: v.string(), opsVersion: v.number(), requestId: v.string(), actorRunId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "finish" });
    const request = await requestOf(ctx, args.requestId);
    if (!request) throw boardError("not-found", "Apify-Auftrag unbekannt.");
    if (request.actorRunId && request.actorRunId !== args.actorRunId) throw boardError("conflict", "Auftrag hat schon einen anderen Run.");
    await ctx.db.patch("apifyRequests", request._id, { actorRunId: args.actorRunId, status: request.status === "unknown" ? "unknown" : "running", updatedAt: Date.now() });
    return null;
  },
});

/** Record the end of a run. A failed run also marks the source, if the claim is still the request's. */
export const finish = mutation({
  args: { token: v.string(), opsVersion: v.number(), requestId: v.string(), status: v.union(v.literal("succeeded"), v.literal("failed")), costUsd: v.optional(v.number()), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "finish" });
    const request = await requestOf(ctx, args.requestId);
    if (!request) throw boardError("not-found", "Apify-Auftrag unbekannt.");
    const now = Date.now();
    await ctx.db.patch("apifyRequests", request._id, { status: args.status, ...(args.costUsd !== undefined ? { costUsd: args.costUsd } : {}), updatedAt: now });
    if (args.status === "failed") {
      const source = await ctx.db
        .query("youtubeSources")
        .withIndex("by_videoId", (q) => q.eq("videoId", request.videoId))
        .unique();
      if (source && source.claim?.claimId === request.claimId) {
        await ctx.db.patch("youtubeSources", source._id, { transcriptStatus: "apify-failed", claim: undefined, error: (args.error ?? "Apify-Abruf fehlgeschlagen.").slice(0, 300), updatedAt: now });
      }
    }
    return null;
  },
});

/**
 * Requests that never got an actorRunId turn `unknown` after 5 minutes, and so
 * does their source. Nothing is bought again automatically.
 */
export const reconcile = mutation({
  args: { token: v.string(), opsVersion: v.number(), videoId: v.string() },
  returns: v.array(requestView),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "finish" });
    const now = Date.now();
    const recent = await ctx.db
      .query("apifyRequests")
      .withIndex("by_videoId", (q) => q.eq("videoId", args.videoId))
      .order("desc")
      .take(20);
    for (const request of recent) {
      if (request.status !== "starting" || request.actorRunId || now - request.startedAt < UNKNOWN_AFTER_MS) continue;
      await ctx.db.patch("apifyRequests", request._id, { status: "unknown", updatedAt: now });
      const source = await ctx.db
        .query("youtubeSources")
        .withIndex("by_videoId", (q) => q.eq("videoId", request.videoId))
        .unique();
      if (source && source.claim?.claimId === request.claimId) {
        await ctx.db.patch("youtubeSources", source._id, { transcriptStatus: "apify-unknown", claim: undefined, error: "Apify-Start ohne Rückmeldung, möglicherweise schon bezahlt. Nur bei Bedarf erneut kaufen.", updatedAt: now });
      }
    }
    const fresh = await ctx.db
      .query("apifyRequests")
      .withIndex("by_videoId", (q) => q.eq("videoId", args.videoId))
      .order("desc")
      .take(20);
    return fresh.map(view);
  },
});

export const latest = query({
  args: { token: v.string(), videoId: v.string() },
  returns: v.union(v.null(), requestView),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const request = await ctx.db
      .query("apifyRequests")
      .withIndex("by_videoId", (q) => q.eq("videoId", args.videoId))
      .order("desc")
      .first();
    return request ? view(request) : null;
  },
});
