import { v } from "convex/values";
import { LIMITS, truncateUtf8, utf8Bytes } from "../lib/board/limits";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { assertWritable, boardError, readConfig, requireToken } from "./boardAuth";
import { effortValidator, engineValidator, provenanceValidator } from "./boardSchema";

/**
 * Chat node data (PLAN.md points 21, 29, 32 to 34): conversations, messages and
 * the run lifecycle. A run is claimed on its conversation (`activeRun`) with a
 * dispatcher, a generation and a lease; its answer is saved as cumulative
 * snapshots with a growing `seq` and locked by the first terminal write.
 * A lapsed claim never writes `aborted` on its own.
 */

export const DISPATCH_LEASE_MS = 30_000;
export const RUN_LEASE_MS = 120_000;
const RUN_ID = /^[A-Za-z0-9_-]{8,100}$/;
const CONVERSATION_ID = /^[A-Za-z0-9_-]{8,100}$/;
const HISTORY_MAX = 400;
const EDGE_SCAN = 1_000;

type Ctx = QueryCtx | MutationCtx;
type Conversation = Doc<"boardConversations">;
type Message = Doc<"boardMessages">;

function clampLease(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 500), 10 * 60_000);
}

async function liveBoard(ctx: Ctx, boardId: string) {
  const board = await ctx.db
    .query("boards")
    .withIndex("by_external_id", (q) => q.eq("id", boardId))
    .unique();
  if (!board || board.deletedAt !== undefined) throw boardError("not-found", "Board nicht gefunden.");
  return board;
}

async function nodeOf(ctx: Ctx, nodeId: string) {
  return ctx.db
    .query("boardNodes")
    .withIndex("by_external_id", (q) => q.eq("id", nodeId))
    .unique();
}

async function liveChatNode(ctx: Ctx, boardId: string, chatNodeId: string) {
  const node = await nodeOf(ctx, chatNodeId);
  if (!node || node.boardId !== boardId || node.deletedAt !== undefined || node.type !== "chatNode") throw boardError("invalid", "Chat-Node gehört nicht zu diesem Board.");
  return node;
}

async function conversationOf(ctx: Ctx, conversationId: string): Promise<Conversation | null> {
  return ctx.db
    .query("boardConversations")
    .withIndex("by_external_id", (q) => q.eq("id", conversationId))
    .unique();
}

async function messageById(ctx: Ctx, id: string): Promise<Message | null> {
  return ctx.db
    .query("boardMessages")
    .withIndex("by_external_id", (q) => q.eq("id", id))
    .unique();
}

/** The assistant message of a run (`<runId>-a`). */
async function answerOf(ctx: Ctx, runId: string): Promise<Message | null> {
  return messageById(ctx, `${runId}-a`);
}

/** Title from the first words of the first message; mention tags become their titles. */
export function conversationTitle(text: string): string {
  const plain = text
    .replace(/<poppy_reference_node\s+[^>]*title="([^"]*)"[^>]*\/>/g, (_all, title: string) => title.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))
    .replace(/\s+/g, " ")
    .trim();
  const words = plain.split(" ").slice(0, 6).join(" ");
  const chars = Array.from(words);
  return (chars.length > 60 ? `${chars.slice(0, 59).join("")}…` : words) || "Neue Unterhaltung";
}

function claimMatches(conversation: Conversation, runId: string, dispatcherId: string, generation: number) {
  const run = conversation.activeRun;
  return Boolean(run && run.runId === runId && run.dispatcherId === dispatcherId && run.generation === generation);
}

async function conversationOfRun(ctx: MutationCtx, runId: string): Promise<{ conversation: Conversation; answer: Message }> {
  const answer = await answerOf(ctx, runId);
  if (!answer) throw boardError("not-found", "Lauf nicht gefunden.");
  const conversation = await conversationOf(ctx, answer.conversationId);
  if (!conversation) throw boardError("not-found", "Unterhaltung nicht gefunden.");
  return { conversation, answer };
}

const messageView = v.object({
  id: v.string(),
  conversationId: v.string(),
  runId: v.optional(v.string()),
  role: v.union(v.literal("user"), v.literal("assistant")),
  text: v.string(),
  truncated: v.optional(v.boolean()),
  reasoning: v.optional(v.string()),
  seq: v.number(),
  status: v.union(v.literal("complete"), v.literal("streaming"), v.literal("aborted"), v.literal("error")),
  terminal: v.boolean(),
  engine: v.optional(engineValidator),
  modelId: v.optional(v.string()),
  promptId: v.optional(v.string()),
  contextManifest: v.optional(provenanceValidator),
  usage: v.optional(v.object({ inputTokens: v.number(), outputTokens: v.number() })),
  error: v.optional(v.object({ code: v.string(), message: v.string() })),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function viewOf(message: Message) {
  const { _id: _i, _creationTime: _c, boardId: _b, textHash: _h, restoreEpoch: _e, ...rest } = message;
  return rest;
}

const activeRunView = v.union(
  v.null(),
  v.object({ runId: v.string(), state: v.union(v.literal("dispatching"), v.literal("running")), dispatcherId: v.string(), generation: v.number(), expiresAt: v.number() }),
);

const conversationView = v.object({ id: v.string(), chatNodeId: v.string(), title: v.string(), activeRun: activeRunView, createdAt: v.number(), updatedAt: v.number() });

function conversationViewOf(conversation: Conversation) {
  const run = conversation.activeRun;
  return {
    id: conversation.id,
    chatNodeId: conversation.chatNodeId,
    title: conversation.title,
    activeRun: run ? { runId: run.runId, state: run.state, dispatcherId: run.dispatcherId, generation: run.generation, expiresAt: run.expiresAt } : null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Reading

export const listConversations = query({
  args: { token: v.string(), boardId: v.string(), chatNodeId: v.string() },
  returns: v.array(conversationView),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await liveBoard(ctx, args.boardId);
    const rows = await ctx.db
      .query("boardConversations")
      .withIndex("by_chatNode", (q) => q.eq("chatNodeId", args.chatNodeId))
      .take(500);
    return rows
      .filter((row) => row.boardId === args.boardId && row.deletedAt === undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 200)
      .map(conversationViewOf);
  },
});

/** The last 50 messages before `before` (createdAt), oldest first (point 23). */
export const listMessages = query({
  args: { token: v.string(), conversationId: v.string(), before: v.optional(v.number()), limit: v.optional(v.number()) },
  returns: v.object({ messages: v.array(messageView), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? LIMITS.messagesPerPage), 1), LIMITS.messagesPerPage);
    const rows = await ctx.db
      .query("boardMessages")
      .withIndex("by_conversation_createdAt", (q) => (args.before === undefined ? q.eq("conversationId", args.conversationId) : q.eq("conversationId", args.conversationId).lt("createdAt", args.before)))
      .order("desc")
      .take(limit + 1);
    return { messages: rows.slice(0, limit).reverse().map(viewOf), hasMore: rows.length > limit };
  },
});

export const runInfo = query({
  args: { token: v.string(), runId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ conversationId: v.string(), boardId: v.string(), message: messageView, activeRun: activeRunView }),
  ),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const answer = await answerOf(ctx, args.runId);
    if (!answer) return null;
    const conversation = await conversationOf(ctx, answer.conversationId);
    const run = conversation?.activeRun?.runId === args.runId ? conversationViewOf(conversation).activeRun : null;
    return { conversationId: answer.conversationId, boardId: answer.boardId, message: viewOf(answer), activeRun: run };
  },
});

type SourceMeta = { id: string; type: "youtubeNode" | "textNode" | "groupNode" | "chatNode"; title: string; notes?: string; parentId?: string; position: { x: number; y: number }; videoId?: string; url?: string; textBytes?: number };

/** Nodes and edges that feed the chat node: incoming edges, their sources, and children of connected groups. */
async function connectedGraph(ctx: QueryCtx, boardId: string, chatNodeId: string) {
  const edges = await ctx.db
    .query("boardEdges")
    .withIndex("by_board_and_target", (q) => q.eq("boardId", boardId).eq("target", chatNodeId))
    .take(EDGE_SCAN);
  const live = edges.filter((edge) => edge.deletedAt === undefined);
  const nodes = new Map<string, SourceMeta>();
  const groups: string[] = [];
  const toMeta = (node: Doc<"boardNodes">): SourceMeta => ({
    id: node.id,
    type: node.type,
    title: node.data.title,
    ...(node.data.notes ? { notes: node.data.notes } : {}),
    ...(node.parentId ? { parentId: node.parentId } : {}),
    position: node.position,
    ...(node.data.videoId ? { videoId: node.data.videoId } : {}),
    ...(node.data.url ? { url: node.data.url } : {}),
    ...(node.textBytes !== undefined ? { textBytes: node.textBytes } : {}),
  });
  for (const edge of live) {
    const node = await nodeOf(ctx, edge.source);
    if (!node || node.boardId !== boardId || node.deletedAt !== undefined) continue;
    nodes.set(node.id, toMeta(node));
    if (node.type === "groupNode") groups.push(node.id);
  }
  if (groups.length > 0) {
    const wanted = new Set(groups);
    for await (const node of ctx.db.query("boardNodes").withIndex("by_board", (q) => q.eq("boardId", boardId))) {
      if (node.deletedAt === undefined && node.parentId && wanted.has(node.parentId)) nodes.set(node.id, toMeta(node));
    }
  }
  return { edges: live.map((edge) => ({ source: edge.source, target: edge.target, createdAt: edge.createdAt })), nodes: [...nodes.values()] };
}

async function sourceOf(ctx: QueryCtx, videoId: string) {
  return ctx.db
    .query("youtubeSources")
    .withIndex("by_videoId", (q) => q.eq("videoId", videoId))
    .unique();
}

const sourceMetaView = v.object({
  id: v.string(),
  type: v.union(v.literal("youtubeNode"), v.literal("textNode"), v.literal("groupNode"), v.literal("chatNode")),
  title: v.string(),
  notes: v.optional(v.string()),
  parentId: v.optional(v.string()),
  position: v.object({ x: v.number(), y: v.number() }),
  videoId: v.optional(v.string()),
  url: v.optional(v.string()),
  textBytes: v.optional(v.number()),
});

const youtubeMetaView = v.object({ videoId: v.string(), status: v.string(), chars: v.optional(v.number()), versionId: v.optional(v.string()), title: v.optional(v.string()) });

/**
 * Step one of point 32: metadata only (text bytes, transcript lengths and
 * states), so the budget can be checked before any content is loaded.
 */
export const chatSources = query({
  args: { token: v.string(), boardId: v.string(), chatNodeId: v.string() },
  returns: v.object({
    revision: v.number(),
    brandVoiceText: v.string(),
    nodes: v.array(sourceMetaView),
    edges: v.array(v.object({ source: v.string(), target: v.string(), createdAt: v.number() })),
    youtube: v.array(youtubeMetaView),
  }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const board = await liveBoard(ctx, args.boardId);
    await liveChatNode(ctx, args.boardId, args.chatNodeId);
    const graph = await connectedGraph(ctx, args.boardId, args.chatNodeId);
    const youtube = [];
    for (const videoId of new Set(graph.nodes.filter((node) => node.type === "youtubeNode" && node.videoId).map((node) => node.videoId!))) {
      const source = await sourceOf(ctx, videoId);
      youtube.push({ videoId, status: source?.transcriptStatus ?? "missing", ...(source?.activeVersion ? { chars: source.activeVersion.chars, versionId: source.activeVersion.versionId } : {}), ...(source?.title ? { title: source.title } : {}) });
    }
    return { revision: board.revision, brandVoiceText: board.brandVoiceText, ...graph, youtube };
  },
});

/**
 * Step two of point 32: the content, in one transactional query, only if the
 * board is still at the confirmed revision. Reads Markdown (never editor data)
 * and the active transcript versions. The caller has checked the budget first.
 */
export const chatContext = query({
  args: { token: v.string(), boardId: v.string(), chatNodeId: v.string(), boardRevision: v.number(), conversationId: v.string(), historyTurns: v.optional(v.number()) },
  returns: v.object({
    revision: v.number(),
    brandVoiceText: v.string(),
    nodes: v.array(sourceMetaView),
    edges: v.array(v.object({ source: v.string(), target: v.string(), createdAt: v.number() })),
    texts: v.array(v.object({ nodeId: v.string(), markdown: v.string(), provenance: v.optional(provenanceValidator) })),
    transcripts: v.array(v.object({ videoId: v.string(), status: v.string(), versionId: v.optional(v.string()), text: v.optional(v.string()), title: v.optional(v.string()) })),
    history: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), text: v.string() })),
  }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const board = await liveBoard(ctx, args.boardId);
    if (board.revision !== args.boardRevision) throw boardError("conflict", "Board hat sich geändert, bitte erneut senden.", { reason: "revision", revision: board.revision });
    await liveChatNode(ctx, args.boardId, args.chatNodeId);
    const graph = await connectedGraph(ctx, args.boardId, args.chatNodeId);
    const texts = [];
    let bytes = 0;
    for (const node of graph.nodes) {
      if (node.type !== "textNode") continue;
      const row = await ctx.db
        .query("boardTextMarkdown")
        .withIndex("by_node", (q) => q.eq("nodeId", node.id))
        .unique();
      const markdown = row?.markdown ?? "";
      bytes += utf8Bytes(markdown);
      texts.push({ nodeId: node.id, markdown, ...(row?.provenance ? { provenance: row.provenance } : {}) });
    }
    const transcripts = [];
    for (const videoId of new Set(graph.nodes.filter((node) => node.type === "youtubeNode" && node.videoId).map((node) => node.videoId!))) {
      const source = await sourceOf(ctx, videoId);
      if (!source || source.transcriptStatus !== "ready" || !source.activeVersion) {
        transcripts.push({ videoId, status: source?.transcriptStatus ?? "missing", ...(source?.title ? { title: source.title } : {}) });
        continue;
      }
      const { versionId } = source.activeVersion;
      let text = "";
      for await (const chunk of ctx.db.query("youtubeTranscriptChunks").withIndex("by_videoId_and_versionId_and_index", (q) => q.eq("videoId", videoId).eq("versionId", versionId))) {
        text += chunk.text;
      }
      bytes += utf8Bytes(text);
      transcripts.push({ videoId, status: "ready", versionId, text, ...(source.title ? { title: source.title } : {}) });
    }
    if (bytes > LIMITS.textQueryBytes) throw boardError("too-large", "Kontext zu groß, bitte Quellen trennen.");
    const turns = Math.min(Math.max(Math.floor(args.historyTurns ?? HISTORY_MAX), 0), HISTORY_MAX);
    const rows = turns === 0 ? [] : await ctx.db
      .query("boardMessages")
      .withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(turns * 2);
    const history = rows
      .reverse()
      .filter((row) => row.role === "user" || (row.status === "complete" && row.text.trim()))
      .map((row) => ({ role: row.role, text: row.text }));
    return { revision: board.revision, brandVoiceText: board.brandVoiceText, ...graph, texts, transcripts, history };
  },
});

// ---------------------------------------------------------------------------
// Run lifecycle

const startOutcome = v.union(
  v.object({ outcome: v.literal("created"), generation: v.number(), expiresAt: v.number(), conversationCreated: v.boolean() }),
  v.object({
    outcome: v.literal("exists"),
    claim: activeRunView,
    status: v.union(v.literal("complete"), v.literal("streaming"), v.literal("aborted"), v.literal("error")),
    terminal: v.boolean(),
  }),
);

/**
 * Point 33: claim the conversation (`dispatching`), user message `<runId>-u`
 * and placeholder `<runId>-a`, all or nothing. The same runId again returns
 * "exists" and creates nothing (33a). Another live run gets 409; a lapsed claim
 * is taken over only with `takeoverRunId`, after Next asked the bridge (33b).
 */
export const startRun = mutation({
  args: {
    token: v.string(),
    opsVersion: v.number(),
    restoreEpoch: v.number(),
    boardId: v.string(),
    chatNodeId: v.string(),
    conversationId: v.string(),
    runId: v.string(),
    dispatcherId: v.string(),
    userText: v.string(),
    engine: engineValidator,
    modelId: v.string(),
    effort: v.optional(effortValidator),
    promptId: v.optional(v.string()),
    contextManifest: provenanceValidator,
    takeoverRunId: v.optional(v.string()),
    dispatchLeaseMs: v.optional(v.number()),
  },
  returns: startOutcome,
  handler: async (ctx, args) => {
    requireToken(args.token);
    const config = await assertWritable(ctx, { opsVersion: args.opsVersion, restoreEpoch: args.restoreEpoch, kind: "new" });
    if (!RUN_ID.test(args.runId)) throw boardError("invalid", "Ungültige runId.");
    if (!CONVERSATION_ID.test(args.conversationId)) throw boardError("invalid", "Ungültige Unterhaltung.");
    if (!args.userText.trim()) throw boardError("invalid", "Leere Nachricht.");
    if (utf8Bytes(args.userText) > LIMITS.messageBytes) throw boardError("too-large", "Nachricht ist zu lang (höchstens 200 KB).");

    const existing = await answerOf(ctx, args.runId);
    if (existing) {
      const conversation = await conversationOf(ctx, existing.conversationId);
      const claim = conversation?.activeRun?.runId === args.runId ? conversationViewOf(conversation).activeRun : null;
      return { outcome: "exists" as const, claim, status: existing.status, terminal: existing.terminal };
    }

    await liveBoard(ctx, args.boardId);
    await liveChatNode(ctx, args.boardId, args.chatNodeId);
    const now = Date.now();
    let conversation = await conversationOf(ctx, args.conversationId);
    if (conversation && (conversation.boardId !== args.boardId || conversation.chatNodeId !== args.chatNodeId || conversation.deletedAt !== undefined)) {
      throw boardError("invalid", "Unterhaltung gehört nicht zu diesem Chat.");
    }
    const run = conversation?.activeRun;
    if (conversation && run) {
      const lapsed = run.expiresAt < now;
      if (!lapsed || args.takeoverRunId !== run.runId) {
        throw boardError("conflict", lapsed ? "Vorheriger Lauf muss erst geprüft werden." : "Vorheriger Lauf läuft noch.", { reason: lapsed ? "claim-lapsed" : "run-active", activeRunId: run.runId, expiresAt: run.expiresAt });
      }
    }
    const generation = (conversation?.runGeneration ?? 0) + 1;
    const expiresAt = now + clampLease(args.dispatchLeaseMs, DISPATCH_LEASE_MS);
    const activeRun = { runId: args.runId, state: "dispatching" as const, dispatcherId: args.dispatcherId, generation, expiresAt, restoreEpoch: config.restoreEpoch };
    let conversationCreated = false;
    if (!conversation) {
      await ctx.db.insert("boardConversations", {
        id: args.conversationId,
        boardId: args.boardId,
        chatNodeId: args.chatNodeId,
        title: conversationTitle(args.userText),
        activeRun,
        runGeneration: generation,
        createdAt: now,
        updatedAt: now,
      });
      conversationCreated = true;
    } else {
      await ctx.db.patch("boardConversations", conversation._id, { activeRun, runGeneration: generation, updatedAt: now });
    }
    // createdAt grows strictly within a conversation, so the history order never depends on clock ties.
    const last = await ctx.db
      .query("boardMessages")
      .withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .first();
    const userAt = Math.max(now, (last?.createdAt ?? 0) + 1);
    const base = { conversationId: args.conversationId, boardId: args.boardId, runId: args.runId, engine: args.engine, modelId: args.modelId, restoreEpoch: config.restoreEpoch, updatedAt: now };
    await ctx.db.insert("boardMessages", { ...base, id: `${args.runId}-u`, role: "user", text: args.userText, seq: 0, status: "complete", terminal: true, ...(args.promptId ? { promptId: args.promptId } : {}), createdAt: userAt });
    await ctx.db.insert("boardMessages", {
      ...base,
      id: `${args.runId}-a`,
      role: "assistant",
      text: "",
      seq: 0,
      status: "streaming",
      terminal: false,
      ...(args.promptId ? { promptId: args.promptId } : {}),
      contextManifest: args.contextManifest,
      createdAt: userAt + 1,
    });
    return { outcome: "created" as const, generation, expiresAt, conversationCreated };
  },
});

/** Point 33a: take over the dispatch lease of a `dispatching` run whose dispatcher went quiet. */
export const takeDispatch = mutation({
  args: { token: v.string(), opsVersion: v.number(), runId: v.string(), dispatcherId: v.string(), dispatchLeaseMs: v.optional(v.number()) },
  returns: v.object({ generation: v.number(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const { conversation, answer } = await conversationOfRun(ctx, args.runId);
    await assertWritable(ctx, { opsVersion: args.opsVersion, restoreEpoch: answer.restoreEpoch, kind: "finish" });
    const run = conversation.activeRun;
    const now = Date.now();
    if (!run || run.runId !== args.runId || run.state !== "dispatching" || run.expiresAt >= now || answer.terminal) {
      throw boardError("conflict", "Der Lauf ist nicht übernehmbar.", { reason: "not-lapsed" });
    }
    const generation = conversation.runGeneration + 1;
    const expiresAt = now + clampLease(args.dispatchLeaseMs, DISPATCH_LEASE_MS);
    await ctx.db.patch("boardConversations", conversation._id, { activeRun: { ...run, dispatcherId: args.dispatcherId, generation, expiresAt }, runGeneration: generation });
    return { generation, expiresAt };
  },
});

const claimArgs = { token: v.string(), opsVersion: v.number(), runId: v.string(), dispatcherId: v.string(), generation: v.number(), runLeaseMs: v.optional(v.number()) };

/** After the bridge's start event: `running` with the run lease (2 min). */
export const markRunning = mutation({
  args: claimArgs,
  returns: v.object({ expiresAt: v.number() }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const { conversation, answer } = await conversationOfRun(ctx, args.runId);
    await assertWritable(ctx, { opsVersion: args.opsVersion, restoreEpoch: answer.restoreEpoch, kind: "finish" });
    if (!claimMatches(conversation, args.runId, args.dispatcherId, args.generation)) throw boardError("conflict", "Der Lauf gehört einem anderen Prozess.", { reason: "claim" });
    const expiresAt = Date.now() + clampLease(args.runLeaseMs, RUN_LEASE_MS);
    await ctx.db.patch("boardConversations", conversation._id, { activeRun: { ...conversation.activeRun!, state: "running", expiresAt } });
    return { expiresAt };
  },
});

/** Every 30 s while the bridge stream is open, text or not (point 33). */
export const renewRun = mutation({
  args: claimArgs,
  returns: v.object({ expiresAt: v.number() }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const { conversation, answer } = await conversationOfRun(ctx, args.runId);
    await assertWritable(ctx, { opsVersion: args.opsVersion, restoreEpoch: answer.restoreEpoch, kind: "finish" });
    if (!claimMatches(conversation, args.runId, args.dispatcherId, args.generation)) throw boardError("conflict", "Der Lauf gehört einem anderen Prozess.", { reason: "claim" });
    const expiresAt = Date.now() + clampLease(args.runLeaseMs, RUN_LEASE_MS);
    // Renewals only happen while the bridge stream is open, so the run is running even if markRunning got lost.
    await ctx.db.patch("boardConversations", conversation._id, { activeRun: { ...conversation.activeRun!, state: "running", expiresAt } });
    return { expiresAt };
  },
});

const appendStatus = v.union(v.literal("applied"), v.literal("duplicate"), v.literal("stale"), v.literal("terminal"));

/**
 * Point 34: cumulative snapshot. Only a higher `seq` is taken; the same `seq`
 * with the same hash is a confirmed duplicate; a lower one is refused. A write
 * also extends the run lease, as long as the claim still belongs to this run.
 */
export const appendRun = mutation({
  args: { token: v.string(), opsVersion: v.number(), runId: v.string(), seq: v.number(), text: v.string(), textHash: v.string(), reasoning: v.optional(v.string()), runLeaseMs: v.optional(v.number()) },
  returns: v.object({ status: appendStatus }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const { conversation, answer } = await conversationOfRun(ctx, args.runId);
    await assertWritable(ctx, { opsVersion: args.opsVersion, restoreEpoch: answer.restoreEpoch, kind: "finish" });
    if (answer.terminal) return { status: "terminal" as const };
    if (args.seq < answer.seq) return { status: "stale" as const };
    if (args.seq === answer.seq) return { status: answer.textHash === args.textHash ? ("duplicate" as const) : ("stale" as const) };
    const cut = truncateUtf8(args.text, LIMITS.messageBytes);
    const now = Date.now();
    await ctx.db.patch("boardMessages", answer._id, {
      text: cut.text,
      ...(cut.truncated ? { truncated: true } : {}),
      ...(args.reasoning !== undefined ? { reasoning: truncateUtf8(args.reasoning, 64 * 1024).text } : {}),
      seq: args.seq,
      textHash: args.textHash,
      updatedAt: now,
    });
    if (conversation.activeRun?.runId === args.runId) {
      const expiresAt = Math.max(conversation.activeRun.expiresAt, now + clampLease(args.runLeaseMs, RUN_LEASE_MS));
      await ctx.db.patch("boardConversations", conversation._id, { activeRun: { ...conversation.activeRun, expiresAt } });
    }
    return { status: "applied" as const };
  },
});

/**
 * Point 34: the terminal write, atomic with the last text. The first terminal
 * write wins (stop against end), every later write is refused as "terminal".
 * The claim is released only if it still belongs to this run.
 */
export const finishRun = mutation({
  args: {
    token: v.string(),
    opsVersion: v.number(),
    runId: v.string(),
    seq: v.number(),
    text: v.string(),
    textHash: v.string(),
    status: v.union(v.literal("complete"), v.literal("aborted"), v.literal("error")),
    reasoning: v.optional(v.string()),
    usage: v.optional(v.object({ inputTokens: v.number(), outputTokens: v.number() })),
    error: v.optional(v.object({ code: v.string(), message: v.string() })),
  },
  returns: v.object({ status: v.union(v.literal("applied"), v.literal("terminal")), finalStatus: v.string() }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const { conversation, answer } = await conversationOfRun(ctx, args.runId);
    await assertWritable(ctx, { opsVersion: args.opsVersion, restoreEpoch: answer.restoreEpoch, kind: "finish" });
    if (answer.terminal) return { status: "terminal" as const, finalStatus: answer.status };
    const now = Date.now();
    // A late finish never shrinks a newer snapshot.
    const useNew = args.seq >= answer.seq;
    const cut = truncateUtf8(useNew ? args.text : answer.text, LIMITS.messageBytes);
    await ctx.db.patch("boardMessages", answer._id, {
      text: cut.text,
      ...(cut.truncated ? { truncated: true } : {}),
      ...(args.reasoning !== undefined ? { reasoning: truncateUtf8(args.reasoning, 64 * 1024).text } : {}),
      seq: Math.max(args.seq, answer.seq),
      textHash: useNew ? args.textHash : answer.textHash,
      status: args.status,
      terminal: true,
      ...(args.usage ? { usage: args.usage } : {}),
      ...(args.error ? { error: { code: args.error.code.slice(0, 60), message: args.error.message.slice(0, 500) } } : {}),
      updatedAt: now,
    });
    if (conversation.activeRun?.runId === args.runId) await ctx.db.patch("boardConversations", conversation._id, { activeRun: undefined, updatedAt: now });
    else await ctx.db.patch("boardConversations", conversation._id, { updatedAt: now });
    return { status: "applied" as const, finalStatus: args.status };
  },
});

// ---------------------------------------------------------------------------
// Conversations

export const renameConversation = mutation({
  args: { token: v.string(), opsVersion: v.number(), restoreEpoch: v.number(), boardId: v.string(), conversationId: v.string(), title: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, restoreEpoch: args.restoreEpoch, kind: "new" });
    const conversation = await conversationOf(ctx, args.conversationId);
    if (!conversation || conversation.boardId !== args.boardId || conversation.deletedAt !== undefined) throw boardError("not-found", "Unterhaltung nicht gefunden.");
    const title = args.title.trim();
    if (!title || Array.from(title).length > 200) throw boardError("invalid", "Titel muss 1 bis 200 Zeichen haben.");
    await ctx.db.patch("boardConversations", conversation._id, { title, updatedAt: Date.now() });
    return null;
  },
});

/** Soft delete; refused while a run still holds the conversation. */
export const deleteConversation = mutation({
  args: { token: v.string(), opsVersion: v.number(), restoreEpoch: v.number(), boardId: v.string(), conversationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, restoreEpoch: args.restoreEpoch, kind: "new" });
    const conversation = await conversationOf(ctx, args.conversationId);
    if (!conversation || conversation.boardId !== args.boardId || conversation.deletedAt !== undefined) throw boardError("not-found", "Unterhaltung nicht gefunden.");
    const now = Date.now();
    if (conversation.activeRun && conversation.activeRun.expiresAt >= now) throw boardError("conflict", "Erst den laufenden Lauf stoppen.", { reason: "run-active" });
    await ctx.db.patch("boardConversations", conversation._id, { deletedAt: now, updatedAt: now });
    return null;
  },
});

/** Mode and epoch for the run journal header and the recovery (points 9d, 34a). */
export const chatConfig = query({
  args: { token: v.string() },
  returns: v.object({ mode: v.string(), restoreEpoch: v.number() }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const config = await readConfig(ctx);
    return { mode: config.mode, restoreEpoch: config.restoreEpoch };
  },
});
