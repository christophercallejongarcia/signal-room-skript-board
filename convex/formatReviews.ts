import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { formatReviewFields } from "./schema";
import { FORMAT_WINDOW_DAYS } from "../lib/config";
import type { Creator, FormatReview, SignalRecord } from "../lib/contracts";
import { reviewCorpus } from "../lib/format-review";

const DAY = 86_400_000;
/** Bounds on one review transaction. Both sit far above the watchlist scale this app is built for. */
const MAX_CREATORS = 500;
const MAX_SIGNALS = 5_000;

/** Newest first, capped so the Format Signals tab never pulls the whole history. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("formatReviews")
      .withIndex("by_periodEnd")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 6, 1), 24));
    return rows.map(({ _id, _creationTime, ...review }) => review);
  },
});

/** Replaces the whole row for review.id, so a rerun on the same run date overwrites it. */
async function write(ctx: MutationCtx, review: FormatReview) {
  const existing = await ctx.db
    .query("formatReviews")
    .withIndex("by_external_id", (q) => q.eq("id", review.id))
    .unique();
  if (existing) await ctx.db.replace(existing._id, review);
  else await ctx.db.insert("formatReviews", review);
}

export const upsert = mutation({
  args: { review: v.object(formatReviewFields) },
  handler: async (ctx, { review }) => {
    await write(ctx, review);
    return null;
  },
});

/**
 * The monthly pass the cron calls. Reads only what the review window covers:
 * signals newest first from the by_published index, so a corpus past MAX_SIGNALS
 * loses its oldest rows rather than the ones the review is about.
 */
export const generate = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, { now }) => {
    const at = now ?? Date.now();
    const since = new Date(at - FORMAT_WINDOW_DAYS * DAY).toISOString();

    const creators = (await ctx.db.query("creators").take(MAX_CREATORS)).map(
      ({ _id, _creationTime, ...creator }) => creator,
    ) as Creator[];
    const signals = (
      await ctx.db
        .query("signals")
        .withIndex("by_published", (q) => q.gte("publishedAt", since))
        .order("desc")
        .take(MAX_SIGNALS)
    ).map(({ _id, _creationTime, ...signal }) => signal) as SignalRecord[];
    // Two, so a rerun on the same run date diffs against the review before it and not against itself.
    const reviews = (await ctx.db.query("formatReviews").withIndex("by_periodEnd").order("desc").take(2)).map(
      ({ _id, _creationTime, ...review }) => review,
    ) as FormatReview[];

    const review = reviewCorpus({ creators, signals, reviews }, at);
    await write(ctx, review);
    return review.id;
  },
});
