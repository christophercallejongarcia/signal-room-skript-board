import { internalMutation, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { isPendingTranscriptExpired } from "../lib/transcripts";
import { transcriptPatchFields } from "./schema";
import { enqueueForSignal } from "./transcriptAnalyses";

/** Optional fields arrive as null from JSON sources; the schema wants them absent. */
function clean<T extends Record<string, unknown>>(doc: T): T {
  return Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== null && value !== undefined)) as T;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("signals").withIndex("by_published").order("desc").collect();
    return rows.map(({ _id, _creationTime, ...signal }) => signal);
  },
});

/** Idempotent: a record with the same id is patched, never duplicated. */
export const bulkUpsert = mutation({
  args: { records: v.array(v.any()) },
  handler: async (ctx, { records }) => {
    let inserted = 0;
    let updated = 0;
    const seen = new Set<string>();
    for (const raw of records) {
      const record = clean(raw);
      const existing = await ctx.db
        .query("signals")
        .withIndex("by_external_id", (q) => q.eq("id", record.id))
        .unique();
      const signalId = existing ? existing._id : await ctx.db.insert("signals", record);
      if (existing) await ctx.db.patch(signalId, record);
      const stored = await ctx.db.get(signalId);
      if (stored) await enqueueForSignal(ctx, stored, new Date().toISOString());
      // A duplicate inside one batch counts once, same as mergeSignals in the file store.
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      if (existing) updated += 1;
      else inserted += 1;
    }
    return { inserted, updated };
  },
});

/** Sets or clears the saved mark. Null clears the field; a refresh never writes it (bulkUpsert only patches delivered fields). */
export const mark = mutation({
  args: { id: v.string(), savedAt: v.union(v.string(), v.null()) },
  handler: async (ctx, { id, savedAt }) => {
    const existing = await ctx.db
      .query("signals")
      .withIndex("by_external_id", (q) => q.eq("id", id))
      .unique();
    if (!existing) return null;
    await ctx.db.patch(existing._id, { savedAt: savedAt ?? undefined });
    const row = await ctx.db.get(existing._id);
    if (!row) return null;
    const { _id, _creationTime, ...signal } = row;
    return signal;
  },
});

/** Atomically claims a Signal for one manual transcript attempt. */
export const claimTranscript = mutation({
  args: { id: v.string(), now: v.string() },
  handler: async (ctx, { id, now }) => {
    const existing = await ctx.db
      .query("signals")
      .withIndex("by_external_id", (q) => q.eq("id", id))
      .unique();
    if (!existing) return null;
    if (existing.transcriptStatus === "pending" && !isPendingTranscriptExpired(existing, new Date(now))) {
      throw new ConvexError({ kind: "transcript-conflict", reason: "pending", message: "A transcript attempt is already in progress." });
    }
    if (existing.transcriptStatus === "ready" || (existing.transcript?.trim() ?? "")) {
      throw new ConvexError({ kind: "transcript-conflict", reason: "ready", message: "This Reel already has a transcript." });
    }
    await ctx.db.patch(existing._id, {
      transcriptStatus: "pending",
      transcriptAttempts: Math.max(0, Math.floor(existing.transcriptAttempts ?? 0)) + 1,
      transcriptUpdatedAt: now,
      transcriptError: undefined,
      // A new actor answer starts a new review chain. The original transcript remains.
      transcriptWorkingCopy: undefined,
      transcriptCorrections: undefined,
    });
    const row = await ctx.db.get(existing._id);
    if (!row) return null;
    const { _id, _creationTime, ...signal } = row;
    return signal;
  },
});

/** Patches only transcript fields; metrics, captions and saved marks stay untouched. */
export const patchTranscript = mutation({
  args: { id: v.string(), patch: v.object(transcriptPatchFields) },
  handler: async (ctx, { id, patch }) => {
    const existing = await ctx.db
      .query("signals")
      .withIndex("by_external_id", (q) => q.eq("id", id))
      .unique();
    if (!existing) return null;
    const updates = {
      ...(patch.transcript === null ? { transcript: undefined } : patch.transcript === undefined ? {} : { transcript: patch.transcript }),
      ...(patch.transcriptSegments === null ? { transcriptSegments: undefined } : patch.transcriptSegments === undefined ? {} : { transcriptSegments: patch.transcriptSegments }),
      ...(patch.transcriptAttempts === undefined ? {} : { transcriptAttempts: patch.transcriptAttempts }),
      ...(patch.transcriptUpdatedAt === undefined ? {} : { transcriptUpdatedAt: patch.transcriptUpdatedAt }),
      ...(patch.transcriptError === null ? { transcriptError: undefined } : patch.transcriptError === undefined ? {} : { transcriptError: patch.transcriptError }),
      ...(patch.transcriptStatus === null ? { transcriptStatus: undefined } : patch.transcriptStatus === undefined ? {} : { transcriptStatus: patch.transcriptStatus }),
      ...(patch.transcriptWorkingCopy === null ? { transcriptWorkingCopy: undefined } : patch.transcriptWorkingCopy === undefined ? {} : { transcriptWorkingCopy: patch.transcriptWorkingCopy }),
      ...(patch.transcriptCorrections === null ? { transcriptCorrections: undefined } : patch.transcriptCorrections === undefined ? {} : { transcriptCorrections: patch.transcriptCorrections }),
    };
    await ctx.db.patch(existing._id, updates);
    const row = await ctx.db.get(existing._id);
    if (!row) return null;
    await enqueueForSignal(ctx, row, patch.transcriptUpdatedAt ?? new Date().toISOString());
    const { _id, _creationTime, ...signal } = row;
    return signal;
  },
});

/** One-time repair for the old parser's false final outcomes. Safe to run again. */
export const resetLegacyTranscriptStatuses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("signals").take(10_000);
    let reset = 0;
    for (const row of rows) {
      const hasTranscript = typeof row.transcript === "string" && row.transcript.trim().length > 0;
      if (hasTranscript || (row.transcriptStatus !== "silent" && row.transcriptStatus !== "missing")) continue;
      await ctx.db.patch(row._id, { transcriptStatus: undefined });
      reset += 1;
    }
    return { seen: rows.length, reset };
  },
});
