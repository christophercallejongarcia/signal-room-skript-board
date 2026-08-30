import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Shape of one logged collection pass; shared with convex/runs.ts so the validator is declared once. */
export const runFields = {
  id: v.string(),
  kind: v.union(v.literal("backfill"), v.literal("refresh"), v.literal("hashtag-sweep")),
  status: v.union(v.literal("ok"), v.literal("partial"), v.literal("failed")),
  startedAt: v.string(),
  finishedAt: v.string(),
  durationMs: v.number(),
  creatorsChecked: v.number(),
  creatorsSkipped: v.optional(v.number()),
  recordsAdded: v.number(),
  recordsUpdated: v.number(),
  errors: v.array(v.object({ creatorId: v.string(), handle: v.string(), message: v.string() })),
  usage: v.optional(
    v.object({
      unreported: v.number(),
      computeUnits: v.optional(v.number()),
      costUsd: v.optional(v.number()),
    }),
  ),
  transcripts: v.optional(v.object({ added: v.number(), silent: v.number(), missing: v.number() })),
  hashtagsChecked: v.optional(v.number()),
  costLimitUsd: v.optional(v.number()),
};

/** One German post collected from an Instagram hashtag search. */
export const hashtagPostFields = {
  id: v.string(),
  externalId: v.string(),
  hashtag: v.string(),
  hashtags: v.array(v.string()),
  ownerHandle: v.optional(v.string()),
  title: v.string(),
  caption: v.optional(v.string()),
  publishedAt: v.string(),
  plays: v.number(),
  likes: v.number(),
  comments: v.number(),
  url: v.optional(v.string()),
  topic: v.string(),
  language: v.literal("de"),
  collectedAt: v.string(),
};

/** Short-form plan attached to an idea; shared with convex/ideas.ts. */
export const storyboardFields = {
  hook: v.string(),
  beats: v.array(v.object({ label: v.string(), detail: v.string() })),
  cta: v.string(),
  caption: v.string(),
  takeaway: v.string(),
};

/** Forecast at an idea; range and potential are null without a comparable base. */
export const forecastFields = {
  range: v.union(v.object({ low: v.number(), high: v.number() }), v.null()),
  potential: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.null()),
  comparableCount: v.number(),
  risk: v.string(),
  tension: v.string(),
};

/** One generated Cover-Lab package; image bytes stay in the local gitignored cache. */
const coverPackageFields = {
  id: v.string(),
  label: v.string(),
  textOverlay: v.string(),
  imageIdea: v.string(),
  colorWorld: v.string(),
  imagePrompt: v.string(),
  imagePath: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  renderedAt: v.optional(v.string()),
};

/** One latest Cover-Lab board. Ideas keep at most one board per format. */
const coverBoardFields = {
  format: v.union(v.literal("reel"), v.literal("youtube")),
  aspectRatio: v.union(v.literal("4:5"), v.literal("16:9")),
  treatment: v.union(v.literal("faceless"), v.literal("face")),
  generatedAt: v.string(),
  packages: v.array(v.object(coverPackageFields)),
};

/** One saved content approach. developRunId is set only while a develop run is in flight. */
export const ideaFields = {
  id: v.string(),
  title: v.string(),
  goal: v.optional(v.string()),
  /** Six production stages in order plus dropped; the moves live in lib/ideas.ts. */
  status: v.union(
    v.literal("captured"),
    v.literal("developing"),
    v.literal("packaging"),
    v.literal("scripting"),
    v.literal("producing"),
    v.literal("published"),
    v.literal("dropped"),
  ),
  sourceSignalId: v.optional(v.string()),
  sourceCreator: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  storyboard: v.optional(v.object(storyboardFields)),
  forecast: v.optional(v.object(forecastFields)),
  /** Bounded by lib/cover-lab.ts to one current board per format. */
  coverBoards: v.optional(v.array(v.object(coverBoardFields))),
  developRunId: v.optional(v.string()),
  developedAt: v.optional(v.string()),
  evidenceCount: v.optional(v.number()),
  createdAt: v.string(),
  updatedAt: v.string(),
};

/** One Signal on a daily Briefing; part of briefingFields. */
const briefingItemFields = {
  signalId: v.string(),
  creatorId: v.string(),
  creatorName: v.string(),
  creator: v.string(),
  title: v.string(),
  publishedAt: v.string(),
  plays: v.number(),
  outlier: v.number(),
  velocity: v.number(),
  score: v.number(),
  caption: v.string(),
  url: v.optional(v.string()),
  coverUrl: v.optional(v.string()),
  thumbnailSeed: v.string(),
  topic: v.string(),
  angle: v.optional(v.string()),
};

/** One daily Briefing; shared with convex/briefings.ts. One document per day. */
export const briefingFields = {
  id: v.string(),
  generatedAt: v.string(),
  day: v.string(),
  windowStart: v.string(),
  windowHours: v.number(),
  sources: v.number(),
  candidates: v.number(),
  angles: v.boolean(),
  items: v.array(v.object(briefingItemFields)),
};

/** One Startpunkt on a daily Slate; part of slateFields. */
const slateStartFields = {
  position: v.number(),
  pitch: v.string(),
  topic: v.string(),
  sourceSignalId: v.string(),
  sourceCreator: v.string(),
  sourceTitle: v.string(),
  sourceUrl: v.optional(v.string()),
  outlier: v.number(),
  plays: v.number(),
  regeneratedAt: v.optional(v.string()),
  ideaId: v.optional(v.string()),
};

/** One daily Slate; shared with convex/slates.ts. One document per day. */
export const slateFields = {
  id: v.string(),
  generatedAt: v.string(),
  updatedAt: v.string(),
  day: v.string(),
  windowStart: v.string(),
  windowHours: v.number(),
  sources: v.number(),
  direction: v.optional(v.string()),
  directionApplied: v.optional(v.string()),
  starts: v.array(v.object(slateStartFields)),
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

/**
 * One Hook variant with the outlier reels cited under it; part of hookRunFields.
 * The five hypotheses are declared once in HOOK_HYPOTHESES (lib/hooks-board.ts);
 * they are restated as literals here so the stored document validates strictly.
 */
const hookVariantFields = {
  hook: v.string(),
  hypothesis: v.union(
    v.literal("curiosity"),
    v.literal("list"),
    v.literal("contrast"),
    v.literal("promise"),
    v.literal("story"),
  ),
  rationale: v.string(),
  evidence: v.array(v.object({ hook: v.string(), creator: v.string(), outlier: v.number() })),
};

/** One logged Hooks-Board run; shared with convex/hookRuns.ts. Every start writes its own row. */
export const hookRunFields = {
  id: v.string(),
  createdAt: v.string(),
  sourceExcerpt: v.string(),
  sourceLength: v.number(),
  direction: v.optional(v.string()),
  requested: v.number(),
  kind: v.union(v.literal("transcript"), v.literal("one-liner")),
  groups: v.array(
    v.object({
      hypothesis: hookVariantFields.hypothesis,
      label: v.string(),
      hint: v.string(),
      variants: v.array(v.object(hookVariantFields)),
    }),
  ),
  evidenceCount: v.number(),
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
    savedAt: v.optional(v.string()),
    transcript: v.optional(v.string()),
    transcriptStatus: v.optional(v.union(v.literal("ready"), v.literal("silent"), v.literal("missing"))),
  })
    .index("by_external_id", ["id"])
    .index("by_creator", ["creatorId"])
    .index("by_published", ["publishedAt"]),
  hashtagPosts: defineTable(hashtagPostFields)
    .index("by_external_id", ["id"])
    .index("by_published", ["publishedAt"]),
  ideas: defineTable(ideaFields)
    .index("by_external_id", ["id"])
    .index("by_createdAt", ["createdAt"]),
  hookRuns: defineTable(hookRunFields)
    .index("by_external_id", ["id"])
    .index("by_createdAt", ["createdAt"]),
  briefings: defineTable(briefingFields)
    .index("by_external_id", ["id"])
    .index("by_day", ["day"]),
  slates: defineTable(slateFields)
    .index("by_external_id", ["id"])
    .index("by_day", ["day"]),
  formatReviews: defineTable(formatReviewFields)
    .index("by_external_id", ["id"])
    .index("by_periodEnd", ["periodEnd"]),
  runs: defineTable(runFields)
    .index("by_external_id", ["id"])
    .index("by_startedAt", ["startedAt"]),
});
