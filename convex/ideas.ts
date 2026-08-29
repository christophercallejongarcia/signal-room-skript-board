import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { forecastFields, ideaFields, storyboardFields } from "./schema";
import { applyStoryboard, claimDevelop, releaseDevelop } from "../lib/ideas";

/** Newest first, capped so the Ideas tab never pulls the whole repository. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("ideas")
      .withIndex("by_createdAt")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 50, 1), 200));
    return rows.map(({ _id, _creationTime, ...idea }) => idea);
  },
});

/** Replaces the whole row for idea.id, so a retried capture never duplicates an idea. */
export const upsert = mutation({
  args: { idea: v.object(ideaFields) },
  handler: async (ctx, { idea }) => {
    const existing = await ctx.db
      .query("ideas")
      .withIndex("by_external_id", (q) => q.eq("id", idea.id))
      .unique();
    if (existing) await ctx.db.replace(existing._id, idea);
    else await ctx.db.insert("ideas", idea);
    return null;
  },
});

/**
 * Claims the idea for one develop run. A second claim overwrites the first, so
 * the slower run finds the claim gone in settleDevelop and its result is dropped.
 * The transition rules live in lib/ideas.ts and are not restated here.
 */
export const claim = mutation({
  args: { id: v.string(), runId: v.string(), now: v.string() },
  handler: async (ctx, { id, runId, now }) => {
    const existing = await ctx.db
      .query("ideas")
      .withIndex("by_external_id", (q) => q.eq("id", id))
      .unique();
    if (!existing) return null;
    const { _id, _creationTime, ...idea } = existing;
    const claimed = claimDevelop(idea, runId, now);
    await ctx.db.replace(_id, claimed);
    return claimed;
  },
});

/** Ends one develop run. A storyboard writes it; null only releases the claim. */
export const settle = mutation({
  args: {
    id: v.string(),
    runId: v.string(),
    now: v.string(),
    storyboard: v.union(v.object(storyboardFields), v.null()),
    forecast: v.optional(v.union(v.object(forecastFields), v.null())),
    evidenceCount: v.optional(v.number()),
  },
  handler: async (ctx, { id, runId, now, storyboard, forecast, evidenceCount }) => {
    const existing = await ctx.db
      .query("ideas")
      .withIndex("by_external_id", (q) => q.eq("id", id))
      .unique();
    if (!existing) return null;
    const { _id, _creationTime, ...idea } = existing;
    const settled = storyboard
      ? applyStoryboard(idea, runId, storyboard, { now, evidenceCount: evidenceCount ?? 0, forecast })
      : releaseDevelop(idea, runId, now);
    // A newer run holds the claim: this result is stale and is dropped.
    if (!settled) return null;
    await ctx.db.replace(_id, settled);
    return settled;
  },
});
