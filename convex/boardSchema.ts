import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Skript-Board tables (PLAN.md section C). Kept apart from the Signal Room
 * tables so `schema.ts` only grows by one spread (additive, point 4).
 */

export const BOARD_SCHEMA_VERSION = 1;

export const boardModeValidator = v.union(v.literal("open"), v.literal("draining"), v.literal("readonly"), v.literal("restoring"));

/** Singleton switch board (`key: "config"`) plus short-lived probe rows written by `board:doctor`. */
export const boardConfigFields = {
  key: v.string(),
  mode: boardModeValidator,
  schemaVersion: v.number(),
  restoreEpoch: v.number(),
  apifyEnabled: v.boolean(),
  drainingSince: v.optional(v.number()),
  updatedAt: v.number(),
};

/** Write lease of one editor tab (point 28). `generation` grows with every takeover. */
export const boardLeaseValidator = v.object({
  sessionId: v.string(),
  generation: v.number(),
  expiresAt: v.number(),
  restoreEpoch: v.number(),
  /** Oldest op the lease holder has not seen confirmed yet, reported by its heartbeat (point 42b). */
  oldestUnconfirmedAt: v.optional(v.number()),
});

export const boardFields = {
  id: v.string(),
  title: v.string(),
  videoSlug: v.optional(v.string()),
  brandVoiceText: v.string(),
  /** +1 for every applied mutation (point 15). */
  revision: v.number(),
  /** Live nodes, kept in step with node create/delete so the 500 cap needs no count query. */
  nodeCount: v.number(),
  lease: v.optional(boardLeaseValidator),
  createdAt: v.number(),
  lastOpenedAt: v.number(),
  deletedAt: v.optional(v.number()),
};

export const nodeTypeValidator = v.union(v.literal("youtubeNode"), v.literal("textNode"), v.literal("groupNode"), v.literal("chatNode"));
export const effortValidator = v.union(v.literal("instant"), v.literal("low"), v.literal("medium"), v.literal("high"));
export const engineValidator = v.union(v.literal("claude"), v.literal("codex"), v.literal("command-code"));

/** Everything a node carries besides geometry. Type-specific fields are optional (point 16). */
export const nodeDataValidator = v.object({
  title: v.string(),
  notes: v.optional(v.string()),
  // youtubeNode
  videoId: v.optional(v.string()),
  url: v.optional(v.string()),
  // chatNode
  engine: v.optional(engineValidator),
  modelId: v.optional(v.string()),
  effort: v.optional(effortValidator),
  brandVoice: v.optional(v.union(v.literal("none"), v.literal("chris"))),
});

export const positionValidator = v.object({ x: v.number(), y: v.number() });

export const boardNodeFields = {
  id: v.string(),
  boardId: v.string(),
  type: nodeTypeValidator,
  position: positionValidator,
  width: v.number(),
  height: v.number(),
  zIndex: v.number(),
  parentId: v.optional(v.string()),
  data: nodeDataValidator,
  /** textNode only: bytes of the Markdown and of the BlockNote JSON, plus the first 500 characters. */
  textBytes: v.optional(v.number()),
  blocksBytes: v.optional(v.number()),
  textPreview: v.optional(v.string()),
  textRev: v.optional(v.number()),
  rev: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  deletedAt: v.optional(v.number()),
  /** The delete op that removed this node, so undo can restore exactly that cascade. */
  deletedByOp: v.optional(v.string()),
};

/** Transitive origin of a text (point 29): transcript versions and text sources it came from. */
export const provenanceValidator = v.object({
  youtube: v.array(v.object({ videoId: v.string(), versionId: v.string(), title: v.optional(v.string()), url: v.optional(v.string()) })),
  texts: v.array(v.object({ nodeId: v.string(), hash: v.string() })),
});

export const boardTextBlocksFields = {
  nodeId: v.string(),
  boardId: v.string(),
  /** BlockNote JSON as a string, at most 600 KB UTF-8, parse depth at most 64 (point 17). */
  blocks: v.string(),
  rev: v.number(),
  /** Editor session that wrote the current revision; decides whether a stale base is our own or a conflict. */
  writerSession: v.optional(v.string()),
};

export const boardTextMarkdownFields = {
  nodeId: v.string(),
  boardId: v.string(),
  /** Markdown for context and export, at most 150 KB UTF-8. */
  markdown: v.string(),
  provenance: v.optional(provenanceValidator),
  rev: v.number(),
};

export const boardEdgeFields = {
  id: v.string(),
  boardId: v.string(),
  source: v.string(),
  sourceHandle: v.literal("connector"),
  target: v.string(),
  targetHandle: v.literal("chat-connector"),
  type: v.literal("connectionEdge"),
  createdAt: v.number(),
  deletedAt: v.optional(v.number()),
  deletedByOp: v.optional(v.string()),
};

/** One row per applied op, for idempotent retries (point 25). Pruned after 14 days. */
export const boardAppliedOpFields = {
  boardId: v.string(),
  opId: v.string(),
  revision: v.number(),
  appliedAt: v.number(),
};

export const transcriptStatusValidator = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("no-captions"),
  v.literal("fetch-failed"),
  v.literal("apify-pending"),
  v.literal("apify-unknown"),
  v.literal("apify-failed"),
);

export const youtubeSourceFields = {
  videoId: v.string(),
  url: v.string(),
  title: v.optional(v.string()),
  channelTitle: v.optional(v.string()),
  channelId: v.optional(v.string()),
  views: v.optional(v.number()),
  publishedAt: v.optional(v.string()),
  durationSec: v.optional(v.number()),
  thumbnailUrl: v.optional(v.string()),
  channelMedianViews: v.optional(v.number()),
  outlier: v.optional(v.number()),
  language: v.optional(v.string()),
  transcriptStatus: transcriptStatusValidator,
  claim: v.optional(v.object({ claimId: v.string(), expiresAt: v.number() })),
  activeVersion: v.optional(v.object({ versionId: v.string(), hash: v.string(), chars: v.number(), source: v.string() })),
  attempts: v.number(),
  error: v.optional(v.string()),
  fetchedAt: v.optional(v.number()),
  updatedAt: v.number(),
};

export const youtubeTranscriptChunkFields = {
  videoId: v.string(),
  versionId: v.string(),
  index: v.number(),
  text: v.string(),
};

export const youtubeChannelFields = {
  channelId: v.string(),
  medianViews: v.number(),
  sampleSize: v.number(),
  fetchedAt: v.number(),
};

export const apifyRequestFields = {
  requestId: v.string(),
  videoId: v.string(),
  claimId: v.string(),
  approvedUsd: v.number(),
  actorRunId: v.optional(v.string()),
  status: v.union(v.literal("starting"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("unknown")),
  costUsd: v.optional(v.number()),
  startedAt: v.number(),
  updatedAt: v.number(),
};

export const activeRunValidator = v.object({
  runId: v.string(),
  state: v.union(v.literal("dispatching"), v.literal("running")),
  dispatcherId: v.string(),
  generation: v.number(),
  expiresAt: v.number(),
  restoreEpoch: v.number(),
});

export const boardConversationFields = {
  id: v.string(),
  boardId: v.string(),
  chatNodeId: v.string(),
  title: v.string(),
  activeRun: v.optional(activeRunValidator),
  /** Highest claim generation ever handed out, so a takeover always grows it. */
  runGeneration: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  deletedAt: v.optional(v.number()),
};

export const messageStatusValidator = v.union(v.literal("complete"), v.literal("streaming"), v.literal("aborted"), v.literal("error"));

export const boardMessageFields = {
  id: v.string(),
  conversationId: v.string(),
  boardId: v.string(),
  runId: v.optional(v.string()),
  role: v.union(v.literal("user"), v.literal("assistant")),
  /** At most 200 KB; longer answers are cut and marked (point 21). */
  text: v.string(),
  truncated: v.optional(v.boolean()),
  reasoning: v.optional(v.string()),
  seq: v.number(),
  textHash: v.optional(v.string()),
  status: messageStatusValidator,
  terminal: v.boolean(),
  engine: v.optional(engineValidator),
  modelId: v.optional(v.string()),
  promptId: v.optional(v.string()),
  contextManifest: v.optional(provenanceValidator),
  usage: v.optional(v.object({ inputTokens: v.number(), outputTokens: v.number() })),
  error: v.optional(v.object({ code: v.string(), message: v.string() })),
  /** Restore epoch the run started in; writes from an older epoch are refused (point 9d). */
  restoreEpoch: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const boardPromptFields = {
  id: v.string(),
  slug: v.string(),
  name: v.string(),
  text: v.string(),
  category: v.string(),
  source: v.union(v.literal("seed"), v.literal("user"), v.literal("playbook")),
  sourcePath: v.optional(v.string()),
  sourceHash: v.optional(v.string()),
  sourceChanged: v.optional(v.boolean()),
  sourceMissing: v.optional(v.boolean()),
  editedByUser: v.boolean(),
  pinned: v.boolean(),
  updatedAt: v.number(),
  deletedAt: v.optional(v.number()),
};

export const boardExportFields = {
  id: v.string(),
  boardId: v.string(),
  videoSlug: v.string(),
  files: v.array(v.object({ name: v.string(), sha256: v.string() })),
  exportedAt: v.number(),
};

export const boardTables = {
  boardConfig: defineTable(boardConfigFields).index("by_key", ["key"]),
  boards: defineTable(boardFields).index("by_external_id", ["id"]).index("by_lastOpenedAt", ["lastOpenedAt"]),
  boardNodes: defineTable(boardNodeFields).index("by_external_id", ["id"]).index("by_board", ["boardId"]),
  boardTextBlocks: defineTable(boardTextBlocksFields).index("by_node", ["nodeId"]),
  boardTextMarkdown: defineTable(boardTextMarkdownFields).index("by_node", ["nodeId"]),
  boardEdges: defineTable(boardEdgeFields).index("by_external_id", ["id"]).index("by_board", ["boardId"]).index("by_board_and_target", ["boardId", "target"]),
  boardAppliedOps: defineTable(boardAppliedOpFields).index("by_board_and_opId", ["boardId", "opId"]).index("by_appliedAt", ["appliedAt"]),
  youtubeSources: defineTable(youtubeSourceFields).index("by_videoId", ["videoId"]),
  youtubeTranscriptChunks: defineTable(youtubeTranscriptChunkFields).index("by_videoId_and_versionId_and_index", ["videoId", "versionId", "index"]),
  youtubeChannels: defineTable(youtubeChannelFields).index("by_channelId", ["channelId"]),
  apifyRequests: defineTable(apifyRequestFields).index("by_requestId", ["requestId"]).index("by_videoId", ["videoId"]),
  boardConversations: defineTable(boardConversationFields).index("by_external_id", ["id"]).index("by_chatNode", ["chatNodeId"]),
  boardMessages: defineTable(boardMessageFields)
    .index("by_external_id", ["id"])
    .index("by_conversation_createdAt", ["conversationId", "createdAt"])
    .index("by_runId", ["runId"]),
  boardPrompts: defineTable(boardPromptFields).index("by_external_id", ["id"]).index("by_slug", ["slug"]).index("by_sourcePath", ["sourcePath"]),
  boardExports: defineTable(boardExportFields).index("by_board", ["boardId"]),
};
