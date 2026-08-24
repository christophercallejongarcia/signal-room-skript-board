import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { runFields } from "./schema";

/** Newest first, capped so the Profile tab never pulls the whole history. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_startedAt")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 10, 1), 100));
    return rows.map(({ _id, _creationTime, ...run }) => run);
  },
});

/** Idempotent on run.id so a retried write never duplicates a run. */
export const upsert = mutation({
  args: { run: v.object(runFields) },
  handler: async (ctx, { run }) => {
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_external_id", (q) => q.eq("id", run.id))
      .unique();
    if (existing) await ctx.db.replace(existing._id, run);
    else await ctx.db.insert("runs", run);
    return null;
  },
});
