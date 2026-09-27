import { v } from "convex/values";
import { edgeId } from "../lib/board/ids";
import { leaseAllowsWrite, LEASE_MS } from "../lib/board/lease";
import { assertTextBudget, LIMITS, previewOf, TextTooLargeError } from "../lib/board/limits";
import { connectionVerdict, makeEdge, OpValidationError, validateOps, type NodeShape, type Op, type OpResult, type Position } from "../lib/board/ops";
import type { Doc } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { assertWritable, boardError, requireToken } from "./boardAuth";

/**
 * Apply a batch of ops from the lease holder (PLAN.md points 25 to 27, 31).
 * Each op reads and checks everything first and writes only when it passes, so
 * a conflicting op changes nothing. A malformed op or an ID from another board
 * aborts the whole batch (the mutation throws and rolls back).
 */

type NodeDoc = Doc<"boardNodes">;
type EdgeDoc = Doc<"boardEdges">;
type Outcome = { status: "applied"; rev?: number; textRev?: number } | { status: "conflict"; reason: string } | { status: "duplicate" };

const EDGE_SCAN_LIMIT = 5_000;
const APPLIED_OP_TTL_MS = 14 * 86_400_000;

class Conflict {
  constructor(public reason: string) {}
}

async function nodeById(ctx: MutationCtx, boardId: string, nodeId: string): Promise<NodeDoc | null> {
  const node = await ctx.db
    .query("boardNodes")
    .withIndex("by_external_id", (q) => q.eq("id", nodeId))
    .unique();
  if (node && node.boardId !== boardId) throw boardError("invalid", "Node gehört nicht zu diesem Board.");
  return node;
}

async function liveNode(ctx: MutationCtx, boardId: string, nodeId: string): Promise<NodeDoc> {
  const node = await nodeById(ctx, boardId, nodeId);
  if (!node || node.deletedAt !== undefined) throw new Conflict(`Node ${nodeId} existiert nicht mehr.`);
  return node;
}

function checkRev(node: NodeDoc, baseRev: number) {
  if (node.rev !== baseRev) throw new Conflict(`Node ${node.id} wurde inzwischen geändert.`);
}

async function boardEdges(ctx: MutationCtx, boardId: string): Promise<EdgeDoc[]> {
  return ctx.db
    .query("boardEdges")
    .withIndex("by_board", (q) => q.eq("boardId", boardId))
    .take(EDGE_SCAN_LIMIT);
}

async function edgeById(ctx: MutationCtx, boardId: string, id: string): Promise<EdgeDoc | null> {
  const edge = await ctx.db
    .query("boardEdges")
    .withIndex("by_external_id", (q) => q.eq("id", id))
    .unique();
  if (edge && edge.boardId !== boardId) throw boardError("invalid", "Kante gehört nicht zu diesem Board.");
  return edge;
}

/** Make the edge source→target live (insert or undelete). Returns true if something changed. */
async function ensureEdge(ctx: MutationCtx, boardId: string, source: string, target: string, now: number): Promise<boolean> {
  const id = edgeId(source, target);
  const existing = await edgeById(ctx, boardId, id);
  if (existing) {
    if (existing.deletedAt === undefined) return false;
    await ctx.db.patch("boardEdges", existing._id, { deletedAt: undefined, deletedByOp: undefined });
    return true;
  }
  const edge = makeEdge(source, target);
  await ctx.db.insert("boardEdges", { ...edge, boardId, createdAt: now });
  return true;
}

async function liveChildren(ctx: MutationCtx, boardId: string, groupId: string): Promise<NodeDoc[]> {
  const nodes = await ctx.db
    .query("boardNodes")
    .withIndex("by_board", (q) => q.eq("boardId", boardId))
    .take(LIMITS.nodesPerBoard * 4);
  return nodes.filter((node) => node.parentId === groupId && node.deletedAt === undefined);
}

async function applyNodeCreate(ctx: MutationCtx, board: Doc<"boards">, op: Extract<Op, { type: "node.create" }>, now: number, nodeCount: { value: number }, sessionId: string): Promise<Outcome> {
  const node: NodeShape = op.node;
  const existing = await nodeById(ctx, board.id, node.id);
  if (existing) throw new Conflict(`Node ${node.id} existiert bereits.`);
  if (nodeCount.value >= LIMITS.nodesPerBoard) throw new Conflict(`Höchstens ${LIMITS.nodesPerBoard} Nodes je Board.`);
  if (node.parentId !== undefined) {
    const parent = await liveNode(ctx, board.id, node.parentId);
    if (parent.type !== "groupNode" || parent.parentId !== undefined) throw boardError("invalid", "parentId muss auf eine Gruppe ohne eigene Gruppe zeigen.");
  }
  let text: { blocks: string; markdown: string; blocksBytes: number; textBytes: number } | null = null;
  if (node.type === "textNode") {
    const blocks = op.text?.blocks ?? "[]";
    const markdown = op.text?.markdown ?? "";
    text = { blocks, markdown, ...assertTextBudget({ blocks, markdown }) };
  }
  await ctx.db.insert("boardNodes", {
    ...node,
    boardId: board.id,
    rev: 1,
    createdAt: now,
    updatedAt: now,
    ...(text ? { textBytes: text.textBytes, blocksBytes: text.blocksBytes, textPreview: previewOf(text.markdown), textRev: 1 } : {}),
  });
  if (text) {
    await ctx.db.insert("boardTextBlocks", { nodeId: node.id, boardId: board.id, blocks: text.blocks, rev: 1, writerSession: sessionId });
    await ctx.db.insert("boardTextMarkdown", { nodeId: node.id, boardId: board.id, markdown: text.markdown, rev: 1, ...(op.text?.provenance ? { provenance: op.text.provenance } : {}) });
  }
  nodeCount.value += 1;
  return { status: "applied", rev: 1, ...(text ? { textRev: 1 } : {}) };
}

async function applyNodeUpdate(ctx: MutationCtx, board: Doc<"boards">, op: Extract<Op, { type: "node.update" }>, now: number): Promise<Outcome> {
  const node = await liveNode(ctx, board.id, op.nodeId);
  checkRev(node, op.baseRev);
  const { data, ...geometry } = op.patch;
  if (data?.videoId !== undefined && node.type !== "youtubeNode") throw boardError("invalid", "videoId nur an YouTube-Nodes.");
  if ((data?.engine !== undefined || data?.modelId !== undefined || data?.effort !== undefined || data?.brandVoice !== undefined) && node.type !== "chatNode") {
    throw boardError("invalid", "Engine-Einstellungen nur an Chat-Nodes.");
  }
  const rev = node.rev + 1;
  await ctx.db.patch("boardNodes", node._id, { ...geometry, ...(data ? { data: { ...node.data, ...data } } : {}), rev, updatedAt: now });
  return { status: "applied", rev };
}

async function applyNodesDelete(ctx: MutationCtx, board: Doc<"boards">, op: Extract<Op, { type: "nodes.delete" }>, now: number, nodeCount: { value: number }): Promise<Outcome> {
  const targets: NodeDoc[] = [];
  for (const entry of op.nodes) {
    const node = await liveNode(ctx, board.id, entry.nodeId);
    checkRev(node, entry.baseRev);
    targets.push(node);
  }
  const ids = new Set(targets.map((node) => node.id));
  for (const group of targets.filter((node) => node.type === "groupNode")) {
    for (const child of await liveChildren(ctx, board.id, group.id)) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        targets.push(child);
      }
    }
  }
  const edges = (await boardEdges(ctx, board.id)).filter((edge) => edge.deletedAt === undefined && (ids.has(edge.source) || ids.has(edge.target)));
  for (const node of targets) await ctx.db.patch("boardNodes", node._id, { deletedAt: now, deletedByOp: op.opId, rev: node.rev + 1, updatedAt: now });
  for (const edge of edges) await ctx.db.patch("boardEdges", edge._id, { deletedAt: now, deletedByOp: op.opId });
  nodeCount.value -= targets.length;
  return { status: "applied" };
}

async function applyNodesRestore(ctx: MutationCtx, board: Doc<"boards">, op: Extract<Op, { type: "nodes.restore" }>, now: number, nodeCount: { value: number }): Promise<Outcome> {
  const nodes = (
    await ctx.db
      .query("boardNodes")
      .withIndex("by_board", (q) => q.eq("boardId", board.id))
      .take(LIMITS.nodesPerBoard * 4)
  ).filter((node) => node.deletedByOp === op.deleteOpId && node.deletedAt !== undefined);
  if (nodes.length === 0) throw new Conflict("Nichts zum Wiederherstellen.");
  if (nodeCount.value + nodes.length > LIMITS.nodesPerBoard) throw new Conflict(`Höchstens ${LIMITS.nodesPerBoard} Nodes je Board.`);
  const restoring = new Set(nodes.map((node) => node.id));
  const liveIds = new Set<string>();
  for (const node of nodes) {
    let parentId = node.parentId;
    let position: Position = node.position;
    if (parentId !== undefined && !restoring.has(parentId)) {
      const parent = await nodeById(ctx, board.id, parentId);
      if (!parent || parent.deletedAt !== undefined) {
        position = parent ? { x: parent.position.x + position.x, y: parent.position.y + position.y } : position;
        parentId = undefined;
      }
    }
    await ctx.db.patch("boardNodes", node._id, { deletedAt: undefined, deletedByOp: undefined, parentId, position, rev: node.rev + 1, updatedAt: now });
    liveIds.add(node.id);
  }
  const edges = (await boardEdges(ctx, board.id)).filter((edge) => edge.deletedByOp === op.deleteOpId && edge.deletedAt !== undefined);
  const isLive = async (id: string) => {
    if (liveIds.has(id)) return true;
    const node = await nodeById(ctx, board.id, id);
    return node !== null && node.deletedAt === undefined;
  };
  for (const edge of edges) {
    if ((await isLive(edge.source)) && (await isLive(edge.target))) await ctx.db.patch("boardEdges", edge._id, { deletedAt: undefined, deletedByOp: undefined });
  }
  nodeCount.value += nodes.length;
  return { status: "applied" };
}

/**
 * Text conflict rule (point 27): a stale base is only a conflict if another
 * session wrote the current revision. A base older than our own last write
 * means our earlier op landed while its confirmation got lost (replay after
 * reload), and the new content supersedes it.
 */
async function applyTextSet(ctx: MutationCtx, board: Doc<"boards">, op: Extract<Op, { type: "text.set" }>, now: number, sessionId: string): Promise<Outcome> {
  const node = await liveNode(ctx, board.id, op.nodeId);
  if (node.type !== "textNode") throw boardError("invalid", "Text nur an Text-Nodes.");
  const blocksRow = await ctx.db
    .query("boardTextBlocks")
    .withIndex("by_node", (q) => q.eq("nodeId", node.id))
    .unique();
  const markdownRow = await ctx.db
    .query("boardTextMarkdown")
    .withIndex("by_node", (q) => q.eq("nodeId", node.id))
    .unique();
  const currentRev = blocksRow?.rev ?? 0;
  if (currentRev !== op.baseTextRev && (op.baseTextRev > currentRev || blocksRow?.writerSession !== sessionId)) {
    throw new Conflict(`Text von ${node.id} wurde inzwischen geändert.`);
  }
  const sizes = assertTextBudget({ blocks: op.blocks, markdown: op.markdown });
  const textRev = currentRev + 1;
  if (blocksRow) await ctx.db.patch("boardTextBlocks", blocksRow._id, { blocks: op.blocks, rev: textRev, writerSession: sessionId });
  else await ctx.db.insert("boardTextBlocks", { nodeId: node.id, boardId: board.id, blocks: op.blocks, rev: textRev, writerSession: sessionId });
  const provenance = op.provenance ?? markdownRow?.provenance;
  if (markdownRow) await ctx.db.patch("boardTextMarkdown", markdownRow._id, { markdown: op.markdown, rev: textRev, provenance });
  else await ctx.db.insert("boardTextMarkdown", { nodeId: node.id, boardId: board.id, markdown: op.markdown, rev: textRev, ...(provenance ? { provenance } : {}) });
  await ctx.db.patch("boardNodes", node._id, { textBytes: sizes.textBytes, blocksBytes: sizes.blocksBytes, textPreview: previewOf(op.markdown), textRev, updatedAt: now });
  return { status: "applied", textRev };
}

async function applyEdgeCreate(ctx: MutationCtx, board: Doc<"boards">, op: Extract<Op, { type: "edge.create" }>, now: number): Promise<Outcome> {
  const source = await liveNode(ctx, board.id, op.source);
  const target = await liveNode(ctx, board.id, op.target);
  const verdict = connectionVerdict(source.type, target.type, source.id, target.id);
  if (verdict) throw boardError("invalid", verdict);
  return (await ensureEdge(ctx, board.id, source.id, target.id, now)) ? { status: "applied" } : { status: "duplicate" };
}

async function applyEdgeDelete(ctx: MutationCtx, board: Doc<"boards">, op: Extract<Op, { type: "edge.delete" }>, now: number): Promise<Outcome> {
  const edge = await edgeById(ctx, board.id, op.edgeId);
  if (!edge) throw new Conflict("Kante existiert nicht.");
  if (edge.deletedAt !== undefined) return { status: "duplicate" };
  await ctx.db.patch("boardEdges", edge._id, { deletedAt: now, deletedByOp: op.opId });
  return { status: "applied" };
}

async function applyGroupCreate(ctx: MutationCtx, board: Doc<"boards">, op: Extract<Op, { type: "group.create" }>, now: number, nodeCount: { value: number }): Promise<Outcome> {
  if (await nodeById(ctx, board.id, op.group.id)) throw new Conflict(`Node ${op.group.id} existiert bereits.`);
  if (nodeCount.value >= LIMITS.nodesPerBoard) throw new Conflict(`Höchstens ${LIMITS.nodesPerBoard} Nodes je Board.`);
  const children: NodeDoc[] = [];
  for (const entry of op.children) {
    const child = await liveNode(ctx, board.id, entry.nodeId);
    checkRev(child, entry.baseRev);
    if (child.type === "groupNode") throw boardError("invalid", "Gruppen können nicht in Gruppen liegen.");
    if (child.parentId !== undefined) throw new Conflict(`Node ${child.id} liegt schon in einer Gruppe.`);
    children.push(child);
  }
  const childIds = new Set(children.map((child) => child.id));
  const edges = (await boardEdges(ctx, board.id)).filter((edge) => edge.deletedAt === undefined && childIds.has(edge.source));
  const targets = [...new Set(edges.map((edge) => edge.target))];

  await ctx.db.insert("boardNodes", { ...op.group, boardId: board.id, rev: 1, createdAt: now, updatedAt: now });
  const positions = new Map(op.children.map((entry) => [entry.nodeId, entry.position]));
  for (const child of children) await ctx.db.patch("boardNodes", child._id, { parentId: op.group.id, position: positions.get(child.id)!, rev: child.rev + 1, updatedAt: now });
  // Poppy scenario 4: single edges of the children to a chat become one edge group → chat.
  for (const edge of edges) await ctx.db.patch("boardEdges", edge._id, { deletedAt: now, deletedByOp: op.opId });
  for (const target of targets) await ensureEdge(ctx, board.id, op.group.id, target, now);
  nodeCount.value += 1;
  return { status: "applied", rev: 1 };
}

async function applyGroupDissolve(ctx: MutationCtx, board: Doc<"boards">, op: Extract<Op, { type: "group.dissolve" }>, now: number, nodeCount: { value: number }): Promise<Outcome> {
  const group = await liveNode(ctx, board.id, op.groupId);
  if (group.type !== "groupNode") throw boardError("invalid", "Nur Gruppen lassen sich auflösen.");
  checkRev(group, op.baseRev);
  const children = await liveChildren(ctx, board.id, group.id);
  const given = new Map(op.children.map((entry) => [entry.nodeId, entry]));
  if (children.length !== given.size || children.some((child) => !given.has(child.id))) throw new Conflict("Die Gruppe hat inzwischen andere Kinder.");
  for (const child of children) checkRev(child, given.get(child.id)!.baseRev);
  const groupEdges = (await boardEdges(ctx, board.id)).filter((edge) => edge.deletedAt === undefined && edge.source === group.id);

  for (const child of children) await ctx.db.patch("boardNodes", child._id, { parentId: undefined, position: given.get(child.id)!.position, rev: child.rev + 1, updatedAt: now });
  await ctx.db.patch("boardNodes", group._id, { deletedAt: now, deletedByOp: op.opId, rev: group.rev + 1, updatedAt: now });
  for (const edge of groupEdges) {
    await ctx.db.patch("boardEdges", edge._id, { deletedAt: now, deletedByOp: op.opId });
    for (const child of children) await ensureEdge(ctx, board.id, child.id, edge.target, now);
  }
  nodeCount.value -= 1;
  return { status: "applied" };
}

async function applyBoardUpdate(ctx: MutationCtx, board: Doc<"boards">, op: Extract<Op, { type: "board.update" }>): Promise<Outcome> {
  const { videoSlug, ...rest } = op.patch;
  await ctx.db.patch("boards", board._id, { ...rest, ...(videoSlug !== undefined ? { videoSlug: videoSlug ?? undefined } : {}) });
  return { status: "applied" };
}

async function applyOne(ctx: MutationCtx, board: Doc<"boards">, op: Op, now: number, nodeCount: { value: number }, sessionId: string): Promise<Outcome> {
  switch (op.type) {
    case "node.create":
      return applyNodeCreate(ctx, board, op, now, nodeCount, sessionId);
    case "node.update":
      return applyNodeUpdate(ctx, board, op, now);
    case "nodes.delete":
      return applyNodesDelete(ctx, board, op, now, nodeCount);
    case "nodes.restore":
      return applyNodesRestore(ctx, board, op, now, nodeCount);
    case "text.set":
      return applyTextSet(ctx, board, op, now, sessionId);
    case "edge.create":
      return applyEdgeCreate(ctx, board, op, now);
    case "edge.delete":
      return applyEdgeDelete(ctx, board, op, now);
    case "group.create":
      return applyGroupCreate(ctx, board, op, now, nodeCount);
    case "group.dissolve":
      return applyGroupDissolve(ctx, board, op, now, nodeCount);
    case "board.update":
      return applyBoardUpdate(ctx, board, op);
  }
}

export const applyOps = mutation({
  args: {
    token: v.string(),
    opsVersion: v.number(),
    restoreEpoch: v.number(),
    boardId: v.string(),
    sessionId: v.string(),
    leaseGeneration: v.number(),
    oldestUnconfirmedAt: v.optional(v.number()),
    ops: v.array(v.any()),
  },
  returns: v.object({
    revision: v.number(),
    results: v.array(v.object({ opId: v.string(), status: v.union(v.literal("applied"), v.literal("duplicate"), v.literal("conflict")), reason: v.optional(v.string()), rev: v.optional(v.number()), textRev: v.optional(v.number()) })),
  }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, restoreEpoch: args.restoreEpoch, kind: "new" });
    let ops: Op[];
    try {
      ops = validateOps(args.ops);
    } catch (error) {
      if (error instanceof OpValidationError) throw boardError("invalid", error.message);
      throw error;
    }
    const board = await ctx.db
      .query("boards")
      .withIndex("by_external_id", (q) => q.eq("id", args.boardId))
      .unique();
    if (!board || board.deletedAt !== undefined) throw boardError("not-found", "Board nicht gefunden.");
    if (!leaseAllowsWrite(board.lease, args.sessionId, args.leaseGeneration)) {
      throw boardError("lease", "Ein anderer Tab bearbeitet dieses Board. Hier nur lesend.", { generation: board.lease?.generation ?? 0 });
    }

    const now = Date.now();
    let revision = board.revision;
    const nodeCount = { value: board.nodeCount };
    const results: OpResult[] = [];
    for (const op of ops) {
      const seen = await ctx.db
        .query("boardAppliedOps")
        .withIndex("by_board_and_opId", (q) => q.eq("boardId", board.id).eq("opId", op.opId))
        .unique();
      if (seen) {
        results.push({ opId: op.opId, status: "duplicate" });
        continue;
      }
      let outcome: Outcome;
      try {
        outcome = await applyOne(ctx, board, op, now, nodeCount, args.sessionId);
      } catch (error) {
        if (error instanceof Conflict) outcome = { status: "conflict", reason: error.reason };
        else if (error instanceof TextTooLargeError) throw boardError("too-large", error.message);
        else throw error;
      }
      if (outcome.status === "applied") {
        revision += 1;
        await ctx.db.insert("boardAppliedOps", { boardId: board.id, opId: op.opId, revision, appliedAt: now });
        results.push({ opId: op.opId, status: "applied", ...(outcome.rev !== undefined ? { rev: outcome.rev } : {}), ...(outcome.textRev !== undefined ? { textRev: outcome.textRev } : {}) });
      } else if (outcome.status === "duplicate") {
        results.push({ opId: op.opId, status: "duplicate" });
      } else {
        results.push({ opId: op.opId, status: "conflict", reason: outcome.reason });
      }
    }
    // Applied-op records only need to outlive client retries; drop a few old ones per call.
    const stale = await ctx.db
      .query("boardAppliedOps")
      .withIndex("by_appliedAt", (q) => q.lt("appliedAt", now - APPLIED_OP_TTL_MS))
      .take(20);
    for (const row of stale) await ctx.db.delete("boardAppliedOps", row._id);

    const fresh = await ctx.db.get("boards", board._id);
    await ctx.db.patch("boards", board._id, {
      revision,
      nodeCount: nodeCount.value,
      lease: fresh?.lease ? { ...fresh.lease, expiresAt: now + LEASE_MS, oldestUnconfirmedAt: args.oldestUnconfirmedAt } : undefined,
    });
    return { revision, results };
  },
});
