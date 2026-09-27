import { v } from "convex/values";
import { decideLease, leaseAllowsWrite, LEASE_MS } from "../lib/board/lease";
import { mutation, type MutationCtx } from "./_generated/server";
import { assertWritable, boardError, requireToken } from "./boardAuth";

/** Write lease per board (PLAN.md point 28). */

async function boardDoc(ctx: MutationCtx, boardId: string) {
  const board = await ctx.db
    .query("boards")
    .withIndex("by_external_id", (q) => q.eq("id", boardId))
    .unique();
  if (!board || board.deletedAt !== undefined) throw boardError("not-found", "Board nicht gefunden.");
  return board;
}

/** Take or renew the lease. `takeover` is the "Hier bearbeiten" button of a read-only tab. */
export const acquire = mutation({
  args: { token: v.string(), opsVersion: v.number(), boardId: v.string(), sessionId: v.string(), takeover: v.boolean() },
  returns: v.union(
    v.object({ granted: v.literal(true), generation: v.number(), expiresAt: v.number(), restoreEpoch: v.number(), revision: v.number(), takeover: v.boolean() }),
    v.object({ granted: v.literal(false), holderExpiresAt: v.number(), revision: v.number() }),
  ),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const config = await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "new" });
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(args.sessionId)) throw boardError("invalid", "Ungültige Sitzung.");
    const board = await boardDoc(ctx, args.boardId);
    const now = Date.now();
    const decision = decideLease(board.lease, { sessionId: args.sessionId, now, takeover: args.takeover, restoreEpoch: config.restoreEpoch });
    if (decision.action === "deny") return { granted: false as const, holderExpiresAt: decision.holderExpiresAt, revision: board.revision };
    await ctx.db.patch("boards", board._id, { lease: decision.lease, lastOpenedAt: now });
    return {
      granted: true as const,
      generation: decision.lease.generation,
      expiresAt: decision.lease.expiresAt,
      restoreEpoch: decision.lease.restoreEpoch,
      revision: board.revision,
      takeover: decision.action === "grant" && board.lease !== undefined && board.lease.sessionId !== args.sessionId,
    };
  },
});

/** Heartbeat every 15 s; also reports the oldest unconfirmed op for the status page (point 42b). */
export const heartbeat = mutation({
  args: { token: v.string(), boardId: v.string(), sessionId: v.string(), generation: v.number(), oldestUnconfirmedAt: v.optional(v.number()) },
  returns: v.object({ ok: v.boolean(), expiresAt: v.number(), revision: v.number(), generation: v.number() }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const board = await boardDoc(ctx, args.boardId);
    if (!leaseAllowsWrite(board.lease, args.sessionId, args.generation)) {
      return { ok: false, expiresAt: board.lease?.expiresAt ?? 0, revision: board.revision, generation: board.lease?.generation ?? 0 };
    }
    const expiresAt = Date.now() + LEASE_MS;
    await ctx.db.patch("boards", board._id, { lease: { ...board.lease!, expiresAt, oldestUnconfirmedAt: args.oldestUnconfirmedAt } });
    return { ok: true, expiresAt, revision: board.revision, generation: args.generation };
  },
});

export const release = mutation({
  args: { token: v.string(), boardId: v.string(), sessionId: v.string(), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const board = await boardDoc(ctx, args.boardId);
    if (leaseAllowsWrite(board.lease, args.sessionId, args.generation)) {
      await ctx.db.patch("boards", board._id, { lease: { ...board.lease!, expiresAt: 0, oldestUnconfirmedAt: undefined } });
    }
    return null;
  },
});
