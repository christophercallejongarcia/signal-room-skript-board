import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { BOARD_SCHEMA_VERSION, boardModeValidator } from "./boardSchema";

/**
 * Admin functions for the board, only reachable with the deployment's admin key
 * (`npx convex run boardAdmin:…`), never from the browser or from Next.
 */

export async function ensureConfig(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("boardConfig")
    .withIndex("by_key", (q) => q.eq("key", "config"))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("boardConfig", {
    key: "config",
    mode: "open",
    schemaVersion: BOARD_SCHEMA_VERSION,
    restoreEpoch: 1,
    apifyEnabled: true,
    updatedAt: Date.now(),
  });
  const created = await ctx.db.get("boardConfig", id);
  if (!created) throw new Error("boardConfig konnte nicht angelegt werden.");
  return created;
}

/** `board:doctor` write probe: insert and delete one row in the same transaction's aftermath. */
export const writeProbe = internalMutation({
  args: { probeId: v.string() },
  returns: v.object({ wrote: v.boolean(), deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const key = `probe:${args.probeId}`;
    const id = await ctx.db.insert("boardConfig", {
      key,
      mode: "readonly",
      schemaVersion: BOARD_SCHEMA_VERSION,
      restoreEpoch: 0,
      apifyEnabled: false,
      updatedAt: Date.now(),
    });
    const wrote = (await ctx.db.get("boardConfig", id))?.key === key;
    await ctx.db.delete("boardConfig", id);
    return { wrote, deleted: (await ctx.db.get("boardConfig", id)) === null };
  },
});

/**
 * Switch the board mode (point 9c/9d). Entering `restoring` issues a new
 * `restoreEpoch`; `draining` remembers when it began so the drain can end after 10 min.
 */
export const setMode = internalMutation({
  args: { mode: boardModeValidator },
  returns: v.object({ mode: boardModeValidator, restoreEpoch: v.number() }),
  handler: async (ctx, args) => {
    const config = await ensureConfig(ctx);
    const restoreEpoch = args.mode === "restoring" && config.mode !== "restoring" ? config.restoreEpoch + 1 : config.restoreEpoch;
    await ctx.db.patch("boardConfig", config._id, {
      mode: args.mode,
      restoreEpoch,
      drainingSince: args.mode === "draining" ? (config.mode === "draining" ? config.drainingSince : Date.now()) : undefined,
      updatedAt: Date.now(),
    });
    return { mode: args.mode, restoreEpoch };
  },
});

export const setApify = internalMutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const config = await ensureConfig(ctx);
    await ctx.db.patch("boardConfig", config._id, { apifyEnabled: args.enabled, updatedAt: Date.now() });
    return null;
  },
});

export const getConfig = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ mode: boardModeValidator, schemaVersion: v.number(), restoreEpoch: v.number(), apifyEnabled: v.boolean() }),
  ),
  handler: async (ctx) => {
    const config = await ctx.db
      .query("boardConfig")
      .withIndex("by_key", (q) => q.eq("key", "config"))
      .unique();
    return config ? { mode: config.mode, schemaVersion: config.schemaVersion, restoreEpoch: config.restoreEpoch, apifyEnabled: config.apifyEnabled } : null;
  },
});
