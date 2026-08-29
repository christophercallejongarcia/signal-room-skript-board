import test from "node:test";
import assert from "node:assert/strict";
import { collectAndStore, runBackfill, runRefresh } from "../lib/collect.ts";

const creator = { id: "instagram-a", name: "A", handle: "@a", network: "instagram", audience: 1000, accent: "#fff", lastCheckedAt: "2026-08-20T00:00:00.000Z" };
const record = { id: "ig-a", externalId: "a", creatorId: creator.id, title: "t", publishedAt: "2026-08-21T00:00:00.000Z", views: 1, likes: 1, comments: 0, durationSeconds: 1, thumbnailSeed: "a", topic: "x" };

function fakeStorage() {
  const creators = [creator];
  const signals = new Map();
  const runs = [];
  return {
    creators,
    runs,
    async listCreators() { return creators; },
    async addCreator(c) { creators.push(c); },
    async upsertCreator(c) {
      const i = creators.findIndex((x) => x.id === c.id);
      if (i >= 0) creators[i] = { ...creators[i], ...c }; else creators.push(c);
    },
    async listSignals() { return [...signals.values()]; },
    async saveSignals(records) {
      let inserted = 0;
      for (const r of records) { const key = r.externalId ?? r.id; if (!signals.has(key)) inserted += 1; signals.set(key, r); }
      return { inserted, updated: records.length - inserted };
    },
    async saveRun(run) { runs.push(run); },
    async listRuns() { return runs; },
  };
}

const noCovers = async () => ({ cached: 0, skipped: 0, failed: 0 });
const usage = { unreported: 0, computeUnits: 0.2, costUsd: 0.08 };
/** collect stub: the records, costed like a normal two-stream pass. */
const yields = (records, u = usage) => async () => ({ records, usage: u });
const NOW = new Date("2026-08-24T12:00:00.000Z");

test("actor failure keeps the cursor and surfaces the error", async () => {
  const storage = fakeStorage();
  await assert.rejects(
    collectAndStore(creator, { storage, collect: async () => { throw new Error("reels stream failed"); }, cacheCovers: noCovers, now: () => NOW }),
    /reels stream failed/,
  );
  assert.equal(storage.creators[0].lastCheckedAt, "2026-08-20T00:00:00.000Z");
  assert.equal((await storage.listSignals()).length, 0);
});

test("success in both streams advances the cursor after storing", async () => {
  const storage = fakeStorage();
  const step = await collectAndStore(creator, { storage, collect: yields([record]), cacheCovers: noCovers, now: () => NOW });
  assert.equal(step.recordsAdded, 1);
  assert.equal(step.recordsUpdated, 0);
  assert.equal(storage.creators[0].lastCheckedAt, NOW.toISOString());
});

test("second run with the same records reports recordsAdded 0", async () => {
  const storage = fakeStorage();
  const deps = { storage, collect: yields([record]), cacheCovers: noCovers, now: () => NOW };
  await collectAndStore(creator, deps);
  const again = await collectAndStore(creator, deps);
  assert.equal(again.recordsAdded, 0);
  assert.equal(again.recordsUpdated, 1);
});

test("runRefresh logs a run, keeps going after a failing creator", async () => {
  const storage = fakeStorage();
  const bad = { ...creator, id: "instagram-bad", handle: "@bad" };
  storage.creators.push(bad);
  const collect = async (c) => { if (c.id === bad.id) throw new Error("boom"); return { records: [record], usage }; };
  const result = await runRefresh({ storage, collect, cacheCovers: noCovers, now: () => NOW });
  assert.equal(result.creatorsChecked, 2);
  assert.equal(result.recordsAdded, 1);
  assert.deepEqual(result.errors, ["@bad: boom"]);
  assert.equal(storage.runs.length, 1);
  const run = storage.runs[0];
  assert.equal(run.kind, "refresh");
  assert.equal(run.status, "partial");
  assert.equal(run.creatorsChecked, 2);
  assert.equal(run.recordsAdded, 1);
  assert.deepEqual(run.errors, [{ creatorId: bad.id, handle: "@bad", message: "boom" }]);
  assert.equal(run.startedAt, NOW.toISOString());
  assert.equal(typeof run.durationMs, "number");
  assert.equal(storage.creators[1].lastCheckedAt, "2026-08-20T00:00:00.000Z", "failed creator keeps its cursor");
  assert.equal(storage.creators[0].lastCheckedAt, NOW.toISOString());
});

test("runRefresh status is ok without errors and failed when every creator fails", async () => {
  const ok = fakeStorage();
  await runRefresh({ storage: ok, collect: yields([]), cacheCovers: noCovers, now: () => NOW });
  assert.equal(ok.runs[0].status, "ok");
  const bad = fakeStorage();
  await runRefresh({ storage: bad, collect: async () => { throw new Error("x"); }, cacheCovers: noCovers, now: () => NOW });
  assert.equal(bad.runs[0].status, "failed");
});

test("runBackfill logs a backfill run and rethrows on failure", async () => {
  const ok = fakeStorage();
  const step = await runBackfill(creator, { storage: ok, collect: yields([record]), cacheCovers: noCovers, now: () => NOW });
  assert.equal(step.recordsAdded, 1);
  assert.equal(ok.runs[0].kind, "backfill");
  assert.equal(ok.runs[0].status, "ok");
  const bad = fakeStorage();
  await assert.rejects(runBackfill(creator, { storage: bad, collect: async () => { throw new Error("nope"); }, cacheCovers: noCovers, now: () => NOW }), /nope/);
  assert.equal(bad.runs[0].status, "failed");
  assert.deepEqual(bad.runs[0].errors, [{ creatorId: creator.id, handle: "@a", message: "nope" }]);
  assert.equal(bad.creators[0].lastCheckedAt, "2026-08-20T00:00:00.000Z");
});

test("two runs in the same millisecond get distinct ids", async () => {
  const storage = fakeStorage();
  const deps = { storage, collect: yields([]), cacheCovers: noCovers, now: () => NOW };
  await runRefresh(deps);
  await runRefresh(deps);
  assert.notEqual(storage.runs[0].id, storage.runs[1].id);
});

test("run usage is the sum over the creators; a failing creator counts as unreported", async () => {
  const storage = fakeStorage();
  const bad = { ...creator, id: "instagram-bad", handle: "@bad" };
  storage.creators.push(bad);
  const collect = async (c) => { if (c.id === bad.id) throw new Error("boom"); return { records: [record], usage }; };
  await runRefresh({ storage, collect, cacheCovers: noCovers, now: () => NOW });
  assert.deepEqual(storage.runs[0].usage, { unreported: 2, computeUnits: 0.2, costUsd: 0.08 });
});

test("a run whose actors reported nothing carries no cost figure, not a zero", async () => {
  const storage = fakeStorage();
  await runRefresh({ storage, collect: yields([record], { unreported: 2 }), cacheCovers: noCovers, now: () => NOW });
  assert.deepEqual(storage.runs[0].usage, { unreported: 2 });
  const bad = fakeStorage();
  await assert.rejects(runBackfill(creator, { storage: bad, collect: async () => { throw new Error("nope"); }, cacheCovers: noCovers, now: () => NOW }));
  assert.deepEqual(bad.runs[0].usage, { unreported: 2 });
});

test("backfill logs the usage of its pass", async () => {
  const storage = fakeStorage();
  await runBackfill(creator, { storage, collect: yields([record]), cacheCovers: noCovers, now: () => NOW });
  assert.deepEqual(storage.runs[0].usage, usage);
});

test("creator limit: the run ends partial, the skipped creators keep their cursor and come first next time", async () => {
  const storage = fakeStorage();
  const stale = { ...creator, id: "instagram-stale", handle: "@stale", lastCheckedAt: "2026-08-10T00:00:00.000Z" };
  const fresh = { ...creator, id: "instagram-fresh", handle: "@fresh", lastCheckedAt: "2026-08-23T00:00:00.000Z" };
  storage.creators.push(stale, fresh);
  const touched = [];
  const collect = async (c) => { touched.push(c.id); return { records: [], usage }; };
  const deps = { storage, collect, cacheCovers: noCovers, now: () => NOW, creatorLimit: 2 };

  const first = await runRefresh(deps);
  assert.deepEqual(touched, ["instagram-stale", "instagram-a"]);
  assert.equal(first.creatorsChecked, 2);
  assert.equal(first.creatorsSkipped, 1);
  assert.equal(storage.runs[0].status, "partial");
  assert.equal(storage.runs[0].creatorsSkipped, 1);
  assert.deepEqual(storage.runs[0].errors, []);
  assert.equal(storage.creators.find((c) => c.id === fresh.id).lastCheckedAt, "2026-08-23T00:00:00.000Z", "skipped creator keeps its cursor");

  touched.length = 0;
  const second = await runRefresh({ ...deps, now: () => new Date(NOW.getTime() + 60_000) });
  assert.equal(touched[0], "instagram-fresh", "the skipped creator is picked up first");
  assert.equal(second.creatorsSkipped, 1);
});

test("creator limit above the list size leaves the run ok and skips nobody", async () => {
  const storage = fakeStorage();
  const result = await runRefresh({ storage, collect: yields([]), cacheCovers: noCovers, now: () => NOW, creatorLimit: 50 });
  assert.equal(result.creatorsSkipped, 0);
  assert.equal(storage.runs[0].status, "ok");
});
