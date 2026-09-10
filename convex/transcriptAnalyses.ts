import { mutation, query, type MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { analysisText, createTranscriptAnalysis, hashTranscriptText, validateTranscriptAnalysisSettlement, TRANSCRIPT_ANALYSIS_CLAIM_TIMEOUT_MS, TRANSCRIPT_ANALYSIS_MAX_ATTEMPTS } from "../lib/transcript-analysis";
import { transcriptAnalysisChunkFields, transcriptAnalysisFields, transcriptAnalysisFindingFields } from "./schema";

function publicRow<T extends { _id: unknown; _creationTime: number }>(row: T) {
  const { _id, _creationTime, ...value } = row;
  return value;
}

async function findSignal(ctx: MutationCtx, id: string) {
  return ctx.db.query("signals").withIndex("by_external_id", (q) => q.eq("id", id)).unique();
}

async function findAnalysis(ctx: MutationCtx, id: string) {
  return ctx.db.query("transcriptAnalyses").withIndex("by_external_id", (q) => q.eq("id", id)).unique();
}

/** Shared write boundary for automatic, manual and catch-up transcript paths. */
export async function enqueueForSignal(ctx: MutationCtx, signal: Parameters<typeof createTranscriptAnalysis>[0], now: string) {
  const analysis = createTranscriptAnalysis(signal, now);
  if (!analysis) return null;
  const existing = await findAnalysis(ctx, analysis.id);
  if (existing) return publicRow(existing);
  const id = await ctx.db.insert("transcriptAnalyses", analysis);
  const inserted = await ctx.db.get(id);
  return inserted ? publicRow(inserted) : null;
}

export const list = query({
  args: { signalId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { signalId, limit }) => {
    const bounded = Math.min(Math.max(Math.floor(limit ?? 100), 1), 500);
    const rows = signalId
      ? await ctx.db.query("transcriptAnalyses").withIndex("by_signal_createdAt", (q) => q.eq("signalId", signalId)).order("desc").take(bounded)
      : await ctx.db.query("transcriptAnalyses").withIndex("by_createdAt").order("desc").take(bounded);
    return rows.map(publicRow);
  },
});

export const enqueue = mutation({
  args: { signalId: v.string(), now: v.string() },
  handler: async (ctx, { signalId, now }) => {
    const signal = await findSignal(ctx, signalId);
    return signal ? enqueueForSignal(ctx, signal, now) : null;
  },
});

export const claim = mutation({
  args: { now: v.string(), claimId: v.string() },
  handler: async (ctx, { now, claimId }) => {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new Error("now must be an ISO date.");
    const [queued, running] = await Promise.all([
      ctx.db.query("transcriptAnalyses").withIndex("by_status_createdAt", (q) => q.eq("status", "queued")).order("asc").take(100),
      ctx.db.query("transcriptAnalyses").withIndex("by_status_createdAt", (q) => q.eq("status", "running")).order("asc").take(100),
    ]);
    for (const analysis of running) {
      if (analysis.attempts >= TRANSCRIPT_ANALYSIS_MAX_ATTEMPTS && Date.parse(analysis.claimExpiresAt ?? "") <= nowMs) {
        await ctx.db.patch(analysis._id, {
          status: "failed",
          error: "The analysis attempt limit was reached after an expired claim.",
          claimId: undefined,
          claimedAt: undefined,
          claimExpiresAt: undefined,
        });
      }
    }
    const candidate = [...queued, ...running]
      .filter((analysis) => analysis.attempts < TRANSCRIPT_ANALYSIS_MAX_ATTEMPTS)
      .filter((analysis) => analysis.status === "queued" || (Date.parse(analysis.claimExpiresAt ?? "") <= nowMs))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!candidate) return null;
    const claimed = {
      status: "running" as const,
      attempts: candidate.attempts + 1,
      claimedAt: now,
      claimExpiresAt: new Date(nowMs + TRANSCRIPT_ANALYSIS_CLAIM_TIMEOUT_MS).toISOString(),
      claimId,
      error: undefined,
    };
    await ctx.db.patch(candidate._id, claimed);
    const row = await ctx.db.get(candidate._id);
    return row ? publicRow(row) : null;
  },
});

export const settle = mutation({
  args: {
    id: v.string(),
    claimId: v.string(),
    status: v.union(v.literal("complete"), v.literal("failed")),
    now: v.string(),
    framework: v.optional(v.union(v.literal("pas"), v.literal("bbb"), v.literal("none"))),
    findings: v.optional(v.array(v.object(transcriptAnalysisFindingFields))),
    chunks: v.optional(v.array(v.object(transcriptAnalysisChunkFields))),
    textLength: v.optional(v.number()),
    complete: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const analysis = await findAnalysis(ctx, args.id);
    if (!analysis || analysis.claimId !== args.claimId) return null;
    const signal = await findSignal(ctx, analysis.signalId);
    const source = signal ? analysisText(signal) : null;
    if (!source || source.textVersion !== analysis.textVersion || hashTranscriptText(source.text) !== analysis.textHash) return null;
    validateTranscriptAnalysisSettlement(args, source.text);
    await ctx.db.patch(analysis._id, {
      status: args.status,
      ...(args.framework === undefined ? {} : { framework: args.framework }),
      ...(args.findings === undefined ? {} : { findings: args.findings }),
      ...(args.chunks === undefined ? {} : { chunks: args.chunks }),
      ...(args.textLength === undefined ? {} : { textLength: args.textLength }),
      ...(args.complete === undefined ? {} : { complete: args.complete }),
      ...(args.status === "failed" ? { error: args.error || "Transcript analysis failed." } : { error: undefined, completedAt: args.now }),
      claimedAt: undefined,
      claimExpiresAt: undefined,
      claimId: undefined,
    });
    const row = await ctx.db.get(analysis._id);
    return row ? publicRow(row) : null;
  },
});

export const retry = mutation({
  args: { id: v.string(), now: v.string() },
  handler: async (ctx, { id, now }) => {
    const analysis = await findAnalysis(ctx, id);
    if (!analysis) return null;
    if (analysis.status !== "failed") throw new ConvexError({ kind: "analysis-retry", reason: "status", message: "Only failed analyses can be retried." });
    if (analysis.attempts >= TRANSCRIPT_ANALYSIS_MAX_ATTEMPTS) {
      throw new ConvexError({ kind: "analysis-retry", reason: "attempts", message: "The analysis attempt limit has been reached." });
    }
    await ctx.db.patch(analysis._id, {
      status: "queued",
      createdAt: now,
      error: undefined,
      claimedAt: undefined,
      claimExpiresAt: undefined,
      claimId: undefined,
    });
    const row = await ctx.db.get(analysis._id);
    return row ? publicRow(row) : null;
  },
});
