import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { briefingFields } from "./schema";

/** Newest first, capped so the Briefing tab never pulls every morning ever written. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("briefings")
      .withIndex("by_day")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 14, 1), 60));
    return rows.map(({ _id, _creationTime, ...briefing }) => briefing);
  },
});

/**
 * Replaces the whole row for briefing.id. The id carries the day, so every refresh
 * of the same day rewrites one document instead of stacking up briefings.
 */
export const upsert = mutation({
  args: { briefing: v.object(briefingFields) },
  handler: async (ctx, { briefing }) => {
    const existing = await ctx.db
      .query("briefings")
      .withIndex("by_external_id", (q) => q.eq("id", briefing.id))
      .unique();
    if (existing) await ctx.db.replace(existing._id, briefing);
    else await ctx.db.insert("briefings", briefing);
    return null;
  },
});
