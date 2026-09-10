import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { ForbiddenMoveError, ScriptRunConflictError, claimScriptRun, moveScript, patchScript, settleScriptRun, validateScriptWrite } from "../lib/scripts";
import type { Script, ScriptPatch, SettleScriptRun } from "../lib/contracts";
import { scriptFields, scriptPatchFields } from "./schema";

/** The row for one canonical Script id, split into its Convex id and domain value. */
async function findScript(ctx: MutationCtx, id: string) {
  const existing = await ctx.db
    .query("scripts")
    .withIndex("by_external_id", (q) => q.eq("id", id))
    .unique();
  if (!existing) return null;
  const { _id, _creationTime, ...script } = existing;
  return { _id, script };
}

function rethrowScriptError(error: unknown): never {
  if (error instanceof ForbiddenMoveError) {
    throw new ConvexError({ kind: "forbidden-move", message: error.message });
  }
  if (error instanceof ScriptRunConflictError) {
    throw new ConvexError({ kind: "script-run-conflict", message: error.message });
  }
  throw error;
}

function withoutSystemFields(row: { _id: unknown; _creationTime: number } & Script) {
  const { _id, _creationTime, ...script } = row;
  return script;
}

/** Newest first, capped so the Scripts tab never pulls the whole repository. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("scripts")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 50, 1), 200));
    return rows.map(withoutSystemFields);
  },
});

/** Loads one Script by its canonical id. */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const row = await ctx.db
      .query("scripts")
      .withIndex("by_external_id", (q) => q.eq("id", id))
      .unique();
    return row ? withoutSystemFields(row) : null;
  },
});

/** Replaces the whole row, so a retried write never creates a duplicate Script. */
export const upsert = mutation({
  args: { script: v.object(scriptFields) },
  handler: async (ctx, { script }) => {
    const existing = await findScript(ctx, script.id);
    try {
      validateScriptWrite(existing?.script ?? null, script);
    } catch (error) {
      rethrowScriptError(error);
    }
    if (existing) await ctx.db.replace(existing._id, script);
    else await ctx.db.insert("scripts", script);
    return null;
  },
});

/** Atomically validates and applies one human editor patch. */
export const patch = mutation({
  args: {
    id: v.string(),
    now: v.string(),
    ...scriptPatchFields,
  },
  handler: async (ctx, args) => {
    const existing = await findScript(ctx, args.id);
    if (!existing) return null;
    const editorPatch: ScriptPatch = {
      ...(args.sections === undefined ? {} : { sections: args.sections }),
      ...(args.framework === undefined ? {} : { framework: args.framework }),
      ...(args.status === undefined ? {} : { status: args.status }),
      ...(args.evidenceSignalIds === undefined ? {} : { evidenceSignalIds: args.evidenceSignalIds }),
      ...(args.hookOptions === undefined ? {} : { hookOptions: args.hookOptions }),
      ...(args.selectedHookId === undefined ? {} : { selectedHookId: args.selectedHookId }),
    };
    let patched: Script;
    try {
      patched = patchScript(existing.script, editorPatch, args.now);
    } catch (error) {
      rethrowScriptError(error);
    }
    await ctx.db.replace(existing._id, patched);
    return patched;
  },
});

/** Claims one Bridge run. A newer claim makes an older result stale at settle time. */
export const claim = mutation({
  args: {
    id: v.string(),
    runId: v.string(),
    now: v.string(),
    rejectIfRunning: v.optional(v.boolean()),
    allowApproved: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, runId, now, rejectIfRunning, allowApproved }) => {
    const existing = await findScript(ctx, id);
    if (!existing) return null;
    let claimed: Script;
    try {
      claimed = claimScriptRun(existing.script, runId, now, { rejectIfRunning, allowApproved });
    } catch (error) {
      rethrowScriptError(error);
    }
    await ctx.db.replace(existing._id, claimed);
    return claimed;
  },
});

/** Settles a run or releases its claim when only now is supplied. */
export const settle = mutation({
  args: {
    id: v.string(),
    runId: v.string(),
    now: v.string(),
    status: v.optional(scriptFields.status),
    framework: v.optional(scriptFields.framework),
    frameworkReason: v.optional(v.string()),
    hookOptions: v.optional(v.array(v.object({
      id: v.string(),
      hook: v.string(),
      angle: v.string(),
      hypothesis: v.string(),
      framework: v.union(v.literal("pas"), v.literal("bbb"), v.literal("none")),
      evidence: v.array(v.object({ signalId: v.string(), hook: v.string(), creator: v.string(), outlier: v.number(), fit: v.string() })),
      edited: v.boolean(),
    }))),
    selectedHookId: v.optional(v.union(v.string(), v.null())),
    sections: v.optional(v.array(v.object({
      kind: v.union(v.literal("hook"), v.literal("beat"), v.literal("transition"), v.literal("cta")),
      label: v.string(),
      text: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    const existing = await findScript(ctx, args.id);
    if (!existing) return null;
    const result: SettleScriptRun = {
      now: args.now,
      ...(args.status === undefined ? {} : { status: args.status }),
      ...(args.framework === undefined ? {} : { framework: args.framework }),
      ...(args.frameworkReason === undefined ? {} : { frameworkReason: args.frameworkReason }),
      ...(args.hookOptions === undefined ? {} : { hookOptions: args.hookOptions }),
      ...(args.selectedHookId === undefined ? {} : { selectedHookId: args.selectedHookId }),
      ...(args.sections === undefined ? {} : { sections: args.sections }),
    };
    let settled: Script | null;
    try {
      settled = settleScriptRun(existing.script, args.runId, result);
    } catch (error) {
      rethrowScriptError(error);
    }
    if (!settled) return null;
    await ctx.db.replace(existing._id, settled);
    return settled;
  },
});

/** Moves a Script by hand and carries a useful reason through production Convex errors. */
export const move = mutation({
  args: { id: v.string(), status: scriptFields.status, now: v.string() },
  handler: async (ctx, { id, status, now }) => {
    const existing = await findScript(ctx, id);
    if (!existing) return null;
    let moved: Script;
    try {
      moved = moveScript(existing.script, status, now);
    } catch (error) {
      if (error instanceof Error && error.name === "ForbiddenMoveError") {
        throw new ConvexError({ kind: "forbidden-move", message: error.message });
      }
      throw error;
    }
    await ctx.db.replace(existing._id, moved);
    return moved;
  },
});
