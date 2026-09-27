import { v } from "convex/values";
import { BOARD_ID_PATTERN } from "../lib/board/ids";
import { mutation, query } from "./_generated/server";
import { assertWritable, boardError, requireToken } from "./boardAuth";

/** Board list and lifecycle (PLAN.md points 15, 56). */

export const TITLE_MAX = 200;

const boardView = v.object({
  id: v.string(),
  title: v.string(),
  videoSlug: v.optional(v.string()),
  revision: v.number(),
  createdAt: v.number(),
  lastOpenedAt: v.number(),
});

export const list = query({
  args: { token: v.string(), limit: v.optional(v.number()) },
  returns: v.array(boardView),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 200), 1), 500);
    const rows = [];
    for await (const board of ctx.db.query("boards").withIndex("by_lastOpenedAt").order("desc")) {
      if (board.deletedAt !== undefined) continue;
      rows.push({ id: board.id, title: board.title, videoSlug: board.videoSlug, revision: board.revision, createdAt: board.createdAt, lastOpenedAt: board.lastOpenedAt });
      if (rows.length >= limit) break;
    }
    return rows;
  },
});

/** Idempotent on `id`: a retried create returns the existing board unchanged. */
export const create = mutation({
  args: { token: v.string(), opsVersion: v.number(), id: v.string(), title: v.string(), brandVoiceText: v.optional(v.string()) },
  returns: v.object({ id: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    await assertWritable(ctx, { opsVersion: args.opsVersion, kind: "new" });
    if (!BOARD_ID_PATTERN.test(args.id)) throw boardError("invalid", "Ungültige Board-ID.");
    const title = args.title.trim();
    if (!title || title.length > TITLE_MAX) throw boardError("invalid", `Titel muss 1 bis ${TITLE_MAX} Zeichen haben.`);
    const existing = await ctx.db
      .query("boards")
      .withIndex("by_external_id", (q) => q.eq("id", args.id))
      .unique();
    if (existing) return { id: existing.id, created: false };
    const now = Date.now();
    await ctx.db.insert("boards", {
      id: args.id,
      title,
      brandVoiceText: args.brandVoiceText ?? "",
      revision: 0,
      createdAt: now,
      lastOpenedAt: now,
    });
    return { id: args.id, created: true };
  },
});
