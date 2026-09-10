import { env, internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { patternEvidenceFields, patternFields, patternRunFields } from "./schema";
import type { SavePatternComparison } from "../lib/contracts";

const publicRow = <T extends { _id: unknown; _creationTime: number }>(row: T) => {
  const { _id, _creationTime, ...value } = row;
  return value;
};

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const runs = await ctx.db.query("patternComparisonRuns").withIndex("by_createdAt").order("desc").take(Math.min(Math.max(Math.floor(limit ?? 20), 1), 100));
    return Promise.all(runs.map(async (run) => {
      const [pattern, evidence] = await Promise.all([
        ctx.db.query("patterns").withIndex("by_external_id", (q) => q.eq("id", run.patternId)).unique(),
        ctx.db.query("patternEvidence").withIndex("by_run", (q) => q.eq("runId", run.id)).take(100),
      ]);
      return pattern ? { pattern: publicRow(pattern), run: publicRow(run), evidence: evidence.map(publicRow) } : null;
    })).then((items) => items.filter((item) => item !== null));
  },
});

const saveArgs = { pattern: v.object(patternFields), evidence: v.array(v.object(patternEvidenceFields)), run: v.object(patternRunFields) };

async function saveComparison(ctx: MutationCtx, args: SavePatternComparison) {
  if (args.evidence.length > 100) throw new Error("A Pattern run may store at most 100 evidence rows.");
  const existingRun = await ctx.db.query("patternComparisonRuns").withIndex("by_external_id", (q) => q.eq("id", args.run.id)).unique();
  if (!existingRun) {
    const existingPattern = await ctx.db.query("patterns").withIndex("by_external_id", (q) => q.eq("id", args.pattern.id)).unique();
    if (existingPattern) await ctx.db.patch(existingPattern._id, { ...args.pattern, status: existingPattern.status === "candidate" && args.pattern.status === "hypothesis" ? "candidate" : args.pattern.status, createdAt: existingPattern.createdAt });
    else await ctx.db.insert("patterns", args.pattern);
    for (const item of args.evidence) {
      const existing = await ctx.db.query("patternEvidence").withIndex("by_external_id", (q) => q.eq("id", item.id)).unique();
      if (!existing) await ctx.db.insert("patternEvidence", item);
    }
    await ctx.db.insert("patternComparisonRuns", args.run);
  }
  const pattern = await ctx.db.query("patterns").withIndex("by_external_id", (q) => q.eq("id", args.pattern.id)).unique();
  const run = await ctx.db.query("patternComparisonRuns").withIndex("by_external_id", (q) => q.eq("id", args.run.id)).unique();
  const evidence = await ctx.db.query("patternEvidence").withIndex("by_run", (q) => q.eq("runId", args.run.id)).take(100);
  if (!pattern || !run) throw new Error("Pattern comparison could not be stored.");
  return { pattern: publicRow(pattern), run: publicRow(run), evidence: evidence.map(publicRow) };
}

function requireWorker(workerToken: string) {
  const expected = env.TRANSCRIPT_ANALYSIS_WORKER_TOKEN;
  if (!expected || workerToken !== expected) throw new ConvexError({ kind: "unauthorized", message: "Pattern discovery worker is not authorized." });
}

export const save = mutation({ args: { ...saveArgs, workerToken: v.string() }, handler: async (ctx, args) => { requireWorker(args.workerToken); return saveComparison(ctx, args); } });
export const saveInternal = internalMutation({ args: saveArgs, handler: saveComparison });
