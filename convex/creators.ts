import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Optional fields arrive as null from JSON sources; the schema wants them absent. */
function clean<T extends Record<string, unknown>>(doc: T): T {
  return Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== null && value !== undefined)) as T;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("creators").collect();
    return rows.map(({ _id, _creationTime, ...creator }) => creator);
  },
});

export const upsert = mutation({
  args: { creator: v.any() },
  handler: async (ctx, { creator: raw }) => {
    const creator = clean(raw);
    const existing = await ctx.db
      .query("creators")
      .withIndex("by_external_id", (q) => q.eq("id", creator.id))
      .unique();
    if (existing) await ctx.db.patch(existing._id, creator);
    else await ctx.db.insert("creators", creator);
  },
});
