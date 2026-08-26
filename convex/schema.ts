import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Shape of one logged collection pass; shared with convex/runs.ts so the validator is declared once. */
export const runFields = {
  id: v.string(),
  kind: v.union(v.literal("backfill"), v.literal("refresh")),
  status: v.union(v.literal("ok"), v.literal("partial"), v.literal("failed")),
  startedAt: v.string(),
  finishedAt: v.string(),
  durationMs: v.number(),
  creatorsChecked: v.number(),
  recordsAdded: v.number(),
  recordsUpdated: v.number(),
  errors: v.array(v.object({ creatorId: v.string(), handle: v.string(), message: v.string() })),
};

/** Short-form plan attached to an idea; shared with convex/ideas.ts. */
export const storyboardFields = {
  hook: v.string(),
  beats: v.array(v.object({ label: v.string(), detail: v.string() })),
  cta: v.string(),
  caption: v.string(),
  takeaway: v.string(),
};

/** One saved content approach. developRunId is set only while a develop run is in flight. */
export const ideaFields = {
  id: v.string(),
  title: v.string(),
  goal: v.optional(v.string()),
  status: v.union(v.literal("captured"), v.literal("developed"), v.literal("produced"), v.literal("dropped")),
  sourceSignalId: v.optional(v.string()),
  sourceCreator: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  storyboard: v.optional(v.object(storyboardFields)),
  developRunId: v.optional(v.string()),
  developedAt: v.optional(v.string()),
  evidenceCount: v.optional(v.number()),
  createdAt: v.string(),
  updatedAt: v.string(),
};

/** One pattern's month over month move; part of formatReviewFields. */
const reviewPatternFields = {
  id: v.string(),
  label: v.string(),
  count: v.number(),
  share: v.number(),
  averageOutlier: v.number(),
  previousCount: v.number(),
  previousShare: v.number(),
  previousAverageOutlier: v.number(),
  countDelta: v.number(),
  shareDelta: v.number(),
  outlierDelta: v.number(),
  move: v.union(v.literal("new"), v.literal("gone"), v.literal("up"), v.literal("down"), v.literal("flat")),
};

/** A small account whose outlier reel carries a named pattern; part of formatReviewFields. */
const risingCreatorFields = {
  creatorId: v.string(),
  name: v.string(),
  handle: v.string(),
  audience: v.number(),
  foreign: v.boolean(),
  patternId: v.string(),
  patternLabel: v.string(),
  patternMove: reviewPatternFields.move,
  signalId: v.string(),
  title: v.string(),
  outlier: v.number(),
  publishedAt: v.string(),
  url: v.optional(v.string()),
};

/** One monthly Format-Review; shared with convex/formatReviews.ts. */
export const formatReviewFields = {
  id: v.string(),
  generatedAt: v.string(),
  periodStart: v.string(),
  periodEnd: v.string(),
  windowDays: v.number(),
  threshold: v.number(),
  previousReviewId: v.optional(v.string()),
  previousPeriodEnd: v.optional(v.string()),
  total: v.number(),
  previousTotal: v.number(),
  patterns: v.array(v.object(reviewPatternFields)),
  risingCreators: v.array(v.object(risingCreatorFields)),
};

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
    foreign: v.optional(v.boolean()),
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
  ideas: defineTable(ideaFields)
    .index("by_external_id", ["id"])
    .index("by_createdAt", ["createdAt"]),
  formatReviews: defineTable(formatReviewFields)
    .index("by_external_id", ["id"])
    .index("by_periodEnd", ["periodEnd"]),
  runs: defineTable(runFields)
    .index("by_external_id", ["id"])
    .index("by_startedAt", ["startedAt"]),
});
