import { mutation, query } from "./_generated/server";
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
