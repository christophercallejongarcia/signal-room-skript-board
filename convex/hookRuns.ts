import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hookRunFields } from "./schema";

/** Newest first, capped so the history rail never pulls every run ever made. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("hookRuns")
      .withIndex("by_createdAt")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 20, 1), 100));
    return rows.map(({ _id, _creationTime, ...run }) => run);
  },
});

/**
 * Replaces the whole row for run.id, so a retried write never duplicates a run.
 * Two runs started in parallel carry two ids and stay two rows.
 */
export const upsert = mutation({
  args: { run: v.object(hookRunFields) },
  handler: async (ctx, { run }) => {
    const existing = await ctx.db
      .query("hookRuns")
      .withIndex("by_external_id", (q) => q.eq("id", run.id))
      .unique();
    if (existing) await ctx.db.replace(existing._id, run);
    else await ctx.db.insert("hookRuns", run);
    return null;
  },
});
