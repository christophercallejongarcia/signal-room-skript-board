/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const value = {
  pattern: { id: "pattern-a", name: "Beleg", definition: "Beleg vor CTA", structure: ["Beleg", "CTA"], status: "candidate" as const, revision: 1, createdAt: "2026-09-10T10:00:00.000Z", updatedAt: "2026-09-10T10:00:00.000Z" },
  evidence: [{ id: "run-a:ig-a", patternId: "pattern-a", runId: "run-a", signalId: "ig-a", verdict: "present" as const, explanation: "Explizit geprüft", evaluatedAt: "2026-09-10T10:00:00.000Z", outlier: 4 }],
  run: { id: "run-a", patternId: "pattern-a", createdAt: "2026-09-10T10:00:00.000Z", windowDays: 90 as const, scope: { market: "de" as const, niche: "core" as const, topic: "ki-agenten", ageBucket: "8-30" as const, owned: false }, thresholds: { positiveReels: 5, positiveCreators: 3, negativeReels: 5 }, status: "insufficient" as const, positiveEvidenceIds: ["run-a:ig-a"], negativeEvidenceIds: [], unknownEvidenceIds: [], positiveCount: 1, negativeCount: 0, unknownCount: 0, positiveCreatorCount: 1, positiveMedian: 4, excluded: { duplicate: 0, market: 0, niche: 0, topic: 0, age: 0, owned: 0, incompleteAnalysis: 0, invalidOutlier: 0 }, caution: "Keine Kausalität." },
};

test("Convex atomically saves one idempotent Pattern comparison with separate evidence", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.patterns.saveInternal, value);
  await t.mutation(internal.patterns.saveInternal, value);
  expect(await t.query(api.patterns.list, { limit: 10 })).toEqual([value]);
  const counts = await t.run(async (ctx) => ({
    patterns: (await ctx.db.query("patterns").collect()).length,
    evidence: (await ctx.db.query("patternEvidence").collect()).length,
    runs: (await ctx.db.query("patternComparisonRuns").collect()).length,
  }));
  expect(counts).toEqual({ patterns: 1, evidence: 1, runs: 1 });
});

test("the public Pattern write fails closed without the server worker token", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.patterns.save, { ...value, workerToken: "wrong" })).rejects.toThrow(/not authorized/i);
});
