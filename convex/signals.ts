import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
      if (existing) await ctx.db.patch(existing._id, record);
      else await ctx.db.insert("signals", record);
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
