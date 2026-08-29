import test from "node:test";
import assert from "node:assert/strict";
import { monthUsage, pickRefreshBatch, sumUsage, usageFromActorRun } from "../lib/run-cost.ts";

test("usageFromActorRun reads compute units and the reported dollar total", () => {
  const usage = usageFromActorRun({ stats: { computeUnits: 0.25 }, usageTotalUsd: 0.31 }, 0.4);
  assert.deepEqual(usage, { computeUnits: 0.25, costUsd: 0.31 });
});

test("usageFromActorRun estimates dollars from compute units when Apify reports no total", () => {
  const usage = usageFromActorRun({ stats: { computeUnits: 0.5 } }, 0.4);
  assert.deepEqual(usage, { computeUnits: 0.5, costUsd: 0.2 });
});

test("usageFromActorRun reports nothing rather than a zero when the run carries no figures", () => {
  assert.deepEqual(usageFromActorRun({}, 0.4), {});
  assert.deepEqual(usageFromActorRun({ stats: { computeUnits: "n/a" }, usageTotalUsd: null }, 0.4), {});
  assert.deepEqual(usageFromActorRun(null, 0.4), {});
});

test("sumUsage adds reported figures and counts the unreported actor runs", () => {
  const usage = sumUsage([{ computeUnits: 0.1, costUsd: 0.04 }, {}, { computeUnits: 0.2, costUsd: 0.08 }]);
  assert.equal(usage.unreported, 1);
  assert.ok(Math.abs(usage.computeUnits - 0.3) < 1e-9);
  assert.ok(Math.abs(usage.costUsd - 0.12) < 1e-9);
});

test("sumUsage leaves the totals absent when no actor run reported anything", () => {
  assert.deepEqual(sumUsage([{}, {}]), { unreported: 2 });
  assert.deepEqual(sumUsage([]), { unreported: 0 });
});

test("monthUsage sums the runs of the current month and counts the ones without a figure", () => {
  const runs = [
    { startedAt: "2026-08-29T10:00:00.000Z", usage: { unreported: 0, computeUnits: 1, costUsd: 0.4 } },
    { startedAt: "2026-08-02T10:00:00.000Z", usage: { unreported: 2 } },
    { startedAt: "2026-08-15T10:00:00.000Z" },
    { startedAt: "2026-07-31T23:59:00.000Z", usage: { unreported: 0, computeUnits: 9, costUsd: 9 } },
  ];
  const month = monthUsage(runs, new Date("2026-08-29T12:00:00.000Z"));
  assert.deepEqual(month, { month: "2026-08", runs: 3, unknownRuns: 2, computeUnits: 1, costUsd: 0.4 });
});

test("monthUsage on an empty month has no total", () => {
  assert.deepEqual(monthUsage([], new Date("2026-08-29T12:00:00.000Z")), { month: "2026-08", runs: 0, unknownRuns: 0 });
});

test("pickRefreshBatch takes the stalest cursors first and never-checked creators before them", () => {
  const creators = [
    { id: "c", lastCheckedAt: "2026-08-20T00:00:00.000Z" },
    { id: "a", lastCheckedAt: "2026-08-10T00:00:00.000Z" },
    { id: "new" },
    { id: "b", lastCheckedAt: "2026-08-15T00:00:00.000Z" },
  ];
  const { batch, skipped } = pickRefreshBatch(creators, 2);
  assert.deepEqual(batch.map((c) => c.id), ["new", "a"]);
  assert.deepEqual(skipped.map((c) => c.id), ["b", "c"]);
});

test("pickRefreshBatch under the limit keeps everyone", () => {
  const creators = [{ id: "a" }, { id: "b" }];
  const { batch, skipped } = pickRefreshBatch(creators, 5);
  assert.equal(batch.length, 2);
  assert.equal(skipped.length, 0);
});
