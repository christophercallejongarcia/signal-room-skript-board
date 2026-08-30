import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hashtagPostFields } from "./schema";

const resultFields = { inserted: v.number(), updated: v.number() };

/** Newest hashtag posts first, capped for the Radar query. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object(hashtagPostFields)),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("hashtagPosts")
      .withIndex("by_published")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 5000, 1), 5000));
    return rows.map(({ _id, _creationTime, ...post }) => post);
  },
});

/** Idempotent on the Instagram shortcode. */
export const bulkUpsert = mutation({
  args: { posts: v.array(v.object(hashtagPostFields)) },
  returns: v.object(resultFields),
  handler: async (ctx, { posts }) => {
    let inserted = 0;
    let updated = 0;
    const seen = new Set<string>();
    for (const post of posts) {
      if (seen.has(post.externalId)) continue;
      seen.add(post.externalId);
      const existing = await ctx.db
        .query("hashtagPosts")
        .withIndex("by_external_id", (q) => q.eq("id", post.id))
        .unique();
      if (existing) {
        await ctx.db.replace(existing._id, post);
        updated += 1;
      } else {
        await ctx.db.insert("hashtagPosts", post);
        inserted += 1;
      }
    }
    return { inserted, updated };
  },
});

/** Kept internal for callers that want an explicit private mutation reference. */
export const upsert = internalMutation({
  args: { post: v.object(hashtagPostFields) },
  returns: v.null(),
  handler: async (ctx, { post }) => {
    const existing = await ctx.db
      .query("hashtagPosts")
      .withIndex("by_external_id", (q) => q.eq("id", post.id))
      .unique();
    if (existing) await ctx.db.replace(existing._id, post);
    else await ctx.db.insert("hashtagPosts", post);
    return null;
  },
});

