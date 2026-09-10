import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { coverBoardFields, coverPackageFields, forecastFields, ideaFields, storyboardFields } from "./schema";
import { ForbiddenMoveError, applyStoryboard, attachStoryboard, claimDevelop, legacyStage, moveIdea, releaseDevelop } from "../lib/ideas";
import { applyCoverUpdate } from "../lib/cover-lab";

/** The row for one external id, split into its Convex id and the Idea the lib functions take. */
async function findIdea(ctx: MutationCtx, id: string) {
  const existing = await ctx.db
    .query("ideas")
    .withIndex("by_external_id", (q) => q.eq("id", id))
    .unique();
  if (!existing) return null;
  const { _id, _creationTime, ...idea } = existing;
  return { _id, idea };
}

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

/** Loads one Idea by its canonical id without relying on the bounded inbox list. */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const row = await ctx.db
      .query("ideas")
      .withIndex("by_external_id", (q) => q.eq("id", id))
      .unique();
    if (!row) return null;
    const { _id, _creationTime, ...idea } = row;
    return idea;
  },
});

/** Replaces the whole row for idea.id, so a retried capture never duplicates an idea. */
export const upsert = mutation({
  args: { idea: v.object(ideaFields) },
  handler: async (ctx, { idea }) => {
    const existing = await findIdea(ctx, idea.id);
    if (existing) await ctx.db.replace(existing._id, idea);
    else await ctx.db.insert("ideas", idea);
    return null;
  },
});

/** Patches only Storyboard-owned fields on the current row in one transaction. */
export const setStoryboard = mutation({
  args: {
    id: v.string(),
    storyboard: v.object(storyboardFields),
    forecast: v.union(v.object(forecastFields), v.null()),
    evidenceCount: v.number(),
    now: v.string(),
  },
  handler: async (ctx, { id, storyboard, forecast, evidenceCount, now }) => {
    const existing = await findIdea(ctx, id);
    if (!existing) return null;
    const updated = attachStoryboard(existing.idea, storyboard, { now, evidenceCount, forecast });
    await ctx.db.replace(existing._id, updated);
    return updated;
  },
});

/** Patches only Cover-Lab fields on the current row in one transaction. */
export const setCover = mutation({
  args: {
    id: v.string(),
    update: v.union(
      v.object({ kind: v.literal("board"), board: v.object(coverBoardFields) }),
      v.object({
        kind: v.literal("package"),
        format: coverBoardFields.format,
        package: v.object(coverPackageFields),
        now: v.string(),
      }),
    ),
  },
  handler: async (ctx, { id, update }) => {
    const existing = await findIdea(ctx, id);
    if (!existing) return null;
    const updated = applyCoverUpdate(existing.idea, update);
    await ctx.db.replace(existing._id, updated);
    return updated;
  },
});

/**
 * Claims the idea for one develop run. A second active claim is a conflict; the
 * transition rules live in lib/ideas.ts and are not restated here.
 */
export const claim = mutation({
  args: { id: v.string(), runId: v.string(), now: v.string() },
  handler: async (ctx, { id, runId, now }) => {
    const existing = await findIdea(ctx, id);
    if (!existing) return null;
    const { _id, idea } = existing;
    if (idea.developRunId && idea.developRunId !== runId) {
      throw new ConvexError({ kind: "develop-conflict", message: "This Idea already has a Develop-Lauf in progress." });
    }
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
    const existing = await findIdea(ctx, id);
    if (!existing) return null;
    const { _id, idea } = existing;
    const settled = storyboard
      ? applyStoryboard(idea, runId, storyboard, { now, evidenceCount: evidenceCount ?? 0, forecast: forecast ?? null })
      : releaseDevelop(idea, runId, now);
    // A newer run holds the claim: this result is stale and is dropped.
    if (!settled) return null;
    await ctx.db.replace(_id, settled);
    return settled;
  },
});

/**
 * Moves the idea by hand. A forbidden move is thrown as ConvexError with
 * kind "forbidden-move", because a plain Error is redacted to "Server Error"
 * on a production deployment and the reason would never reach the UI.
 */
export const move = mutation({
  args: { id: v.string(), status: ideaFields.status, now: v.string() },
  handler: async (ctx, { id, status, now }) => {
    const existing = await findIdea(ctx, id);
    if (!existing) return null;
    const { _id, idea } = existing;
    let moved;
    try {
      moved = moveIdea(idea, status, now);
    } catch (error) {
      if (error instanceof ForbiddenMoveError) throw new ConvexError({ kind: "forbidden-move", message: error.message });
      throw error;
    }
    await ctx.db.replace(_id, moved);
    return moved;
  },
});

/**
 * Ran once on 2026-08-29 with the status union temporarily widened by the old
 * literals (developed -> developing, produced -> producing; 4 rows moved).
 * Idempotent, kept so a store restored from an older export can be mapped
 * again: widen the union, `npx convex run ideas:migrateStages`, tighten it.
 */
export const migrateStages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("ideas").take(1000);
    let moved = 0;
    for (const row of rows) {
      const stage = legacyStage(String(row.status));
      if (!stage || stage === row.status) continue;
      await ctx.db.patch(row._id, { status: stage });
      moved += 1;
    }
    return { seen: rows.length, moved };
  },
});
