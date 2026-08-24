import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  creators: defineTable({
    id: v.string(),
    name: v.string(),
    handle: v.string(),
    network: v.string(),
    audience: v.number(),
    accent: v.string(),
    avatarUrl: v.optional(v.string()),
    url: v.optional(v.string()),
    owned: v.optional(v.boolean()),
    lastCheckedAt: v.optional(v.string()),
  }).index("by_external_id", ["id"]),
  signals: defineTable({
    id: v.string(),
    externalId: v.optional(v.string()),
    creatorId: v.string(),
    title: v.string(),
    publishedAt: v.string(),
    views: v.number(),
    plays: v.optional(v.number()),
    likes: v.number(),
    comments: v.number(),
    durationSeconds: v.number(),
    thumbnailSeed: v.string(),
    thumbnailUrl: v.optional(v.string()),
    url: v.optional(v.string()),
    caption: v.optional(v.string()),
    format: v.optional(v.string()),
    topic: v.string(),
  })
    .index("by_external_id", ["id"])
    .index("by_creator", ["creatorId"])
    .index("by_published", ["publishedAt"]),
  ideas: defineTable({
    title: v.string(),
    goal: v.optional(v.string()),
    storyboard: v.optional(v.any()),
    createdAt: v.string(),
  }),
  runs: defineTable({
    kind: v.string(),
    startedAt: v.string(),
    finishedAt: v.optional(v.string()),
    creatorsChecked: v.number(),
    recordsAdded: v.number(),
    error: v.optional(v.string()),
  }),
});
