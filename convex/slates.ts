import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { slateFields } from "./schema";

/** Newest first, capped so the Briefing tab never pulls every morning ever written. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("slates")
      .withIndex("by_day")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 14, 1), 60));
    return rows.map(({ _id, _creationTime, ...slate }) => slate);
  },
});

/**
 * Replaces the whole row for slate.id. The id carries the day, so a regenerated
 * start, a stored direction and a captured Idea all rewrite one document.
 */
export const upsert = mutation({
  args: { slate: v.object(slateFields) },
  handler: async (ctx, { slate }) => {
    const existing = await ctx.db
      .query("slates")
      .withIndex("by_external_id", (q) => q.eq("id", slate.id))
      .unique();
    if (existing) await ctx.db.replace(existing._id, slate);
    else await ctx.db.insert("slates", slate);
    return null;
  },
});
