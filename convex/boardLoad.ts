import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { LIMITS } from "../lib/board/limits";
import { query, type QueryCtx } from "./_generated/server";
import { boardError, readConfig, requireToken } from "./boardAuth";
import schema from "./schema";

/**
 * Loading a board (PLAN.md point 23): metadata, nodes and edges in pages of 200,
 * full texts only on demand and at most 8 MB of editor data per query. No query
 * here reads unbounded or anywhere near 16 MiB.
 */

async function liveBoard(ctx: QueryCtx, boardId: string) {
  const board = await ctx.db
    .query("boards")
    .withIndex("by_external_id", (q) => q.eq("id", boardId))
    .unique();
  if (!board || board.deletedAt !== undefined) throw boardError("not-found", "Board nicht gefunden.");
  return board;
}

export const getBoard = query({
  args: { token: v.string(), boardId: v.string() },
  returns: v.object({
    id: v.string(),
    title: v.string(),
    videoSlug: v.optional(v.string()),
    brandVoiceText: v.string(),
    revision: v.number(),
    nodeCount: v.number(),
    restoreEpoch: v.number(),
    mode: v.string(),
    lease: v.union(v.null(), v.object({ sessionId: v.string(), generation: v.number(), expiresAt: v.number() })),
  }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const board = await liveBoard(ctx, args.boardId);
    const config = await readConfig(ctx);
    return {
      id: board.id,
      title: board.title,
      videoSlug: board.videoSlug,
      brandVoiceText: board.brandVoiceText,
      revision: board.revision,
      nodeCount: board.nodeCount,
      restoreEpoch: config.restoreEpoch,
      mode: config.mode,
      lease: board.lease ? { sessionId: board.lease.sessionId, generation: board.lease.generation, expiresAt: board.lease.expiresAt } : null,
    };
  },
});

function clampPage<T extends { numItems: number }>(opts: T): T {
  return { ...opts, numItems: Math.min(Math.max(Math.floor(opts.numItems), 1), LIMITS.pageSize) };
}

export const listNodes = query({
  args: { token: v.string(), boardId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("boardNodes")),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await liveBoard(ctx, args.boardId);
    const result = await ctx.db
      .query("boardNodes")
      .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
      .paginate(clampPage(args.paginationOpts));
    return { ...result, page: result.page.filter((node) => node.deletedAt === undefined) };
  },
});

export const listEdges = query({
  args: { token: v.string(), boardId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("boardEdges")),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await liveBoard(ctx, args.boardId);
    const result = await ctx.db
      .query("boardEdges")
      .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
      .paginate(clampPage(args.paginationOpts));
    return { ...result, page: result.page.filter((edge) => edge.deletedAt === undefined) };
  },
});

/**
 * Editor data (BlockNote JSON) for the requested text nodes, in request order,
 * until 8 MB are reached. The rest comes back as `pending` for a follow-up query.
 */
export const getTexts = query({
  args: { token: v.string(), boardId: v.string(), nodeIds: v.array(v.string()) },
  returns: v.object({
    texts: v.array(v.object({ nodeId: v.string(), blocks: v.string(), rev: v.number() })),
    pending: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await liveBoard(ctx, args.boardId);
    if (args.nodeIds.length > LIMITS.nodesPerBoard) throw boardError("invalid", "Zu viele Nodes angefragt.");
    const texts: { nodeId: string; blocks: string; rev: number }[] = [];
    const pending: string[] = [];
    let bytes = 0;
    for (const nodeId of args.nodeIds) {
      if (pending.length > 0) {
        pending.push(nodeId);
        continue;
      }
      const node = await ctx.db
        .query("boardNodes")
        .withIndex("by_external_id", (q) => q.eq("id", nodeId))
        .unique();
      if (!node || node.boardId !== args.boardId) throw boardError("invalid", "Node gehört nicht zu diesem Board.");
      if (node.type !== "textNode") continue;
      const size = node.blocksBytes ?? 0;
      if (texts.length > 0 && bytes + size > LIMITS.textQueryBytes) {
        pending.push(nodeId);
        continue;
      }
      const row = await ctx.db
        .query("boardTextBlocks")
        .withIndex("by_node", (q) => q.eq("nodeId", nodeId))
        .unique();
      bytes += size;
      texts.push({ nodeId, blocks: row?.blocks ?? "[]", rev: row?.rev ?? 0 });
    }
    return { texts, pending };
  },
});
