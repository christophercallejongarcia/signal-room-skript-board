import test from "node:test";
import assert from "node:assert/strict";
import { runRefresh } from "../lib/collect.ts";

const creator = { id: "instagram-a", name: "A", handle: "@a", network: "instagram", audience: 1000, accent: "#fff", lastCheckedAt: "2026-08-20T00:00:00.000Z" };
function reel(id, plays, extra = {}) {
  return { id: `ig-${id}`, externalId: id, creatorId: creator.id, title: `Reel ${id}`, publishedAt: "2026-08-21T00:00:00.000Z", views: 0, plays, likes: 0, comments: 0, durationSeconds: 20, thumbnailSeed: id, topic: "x", format: "reel", url: `https://www.instagram.com/p/${id}/`, ...extra };
}

function fakeStorage(seed = []) {
  const creators = [creator];
  const signals = new Map(seed.map((s) => [s.id, s]));
  const runs = [];
  return {
    signals,
    runs,
    async listCreators() { return creators; },
    async upsertCreator(c) { creators[0] = { ...creators[0], ...c }; },
    async listSignals() { return [...signals.values()]; },
    async saveSignals(records) {
      let inserted = 0;
      for (const r of records) { if (!signals.has(r.id)) inserted += 1; signals.set(r.id, { ...(signals.get(r.id) ?? {}), ...r }); }
      return { inserted, updated: records.length - inserted };
    },
    async saveRun(run) { runs.push(run); },
  };
}

const noCovers = async () => ({ cached: 0, skipped: 0, failed: 0 });
const NOW = new Date("2026-08-24T12:00:00.000Z");
const collectUsage = { unreported: 0, computeUnits: 0.2, costUsd: 0.08 };
const transcriptUsage = { unreported: 0, costUsd: 0.02 };

function deps(storage, transcribe, extra = {}) {
  return { storage, collect: async () => ({ records: [reel("loud", 5000), reel("spoken", 3000), reel("quiet", 500)], usage: collectUsage }), cacheCovers: noCovers, now: () => NOW, transcribe, ...extra };
}

test("outlier reels get a transcript once; a reel without speech is marked silent; the run counts and costs it", async () => {
  const storage = fakeStorage();
  const calls = [];
  const transcribe = async (reels) => {
    calls.push(reels.map((r) => r.id));
    return { results: [{ id: "ig-loud", transcript: "Hör auf mit Notion. Wirklich." }, { id: "ig-spoken", transcript: null }], usage: transcriptUsage };
  };
  await runRefresh(deps(storage, transcribe));
  assert.deepEqual(calls, [["ig-loud", "ig-spoken"]]);
  assert.equal(storage.signals.get("ig-loud").transcript, "Hör auf mit Notion. Wirklich.");
  assert.equal(storage.signals.get("ig-loud").transcriptStatus, "ready");
  assert.equal(storage.signals.get("ig-spoken").transcriptStatus, "silent");
  assert.equal(storage.signals.get("ig-spoken").transcript, undefined);
  assert.equal(storage.signals.get("ig-quiet").transcriptStatus, undefined);
  const run = storage.runs[0];
  assert.deepEqual(run.transcripts, { added: 1, silent: 1 });
  assert.equal(run.status, "ok");
  assert.equal(run.usage.costUsd, 0.1);

  // Second run: nothing to fetch, the actor is not called.
  await runRefresh(deps(storage, transcribe));
  assert.equal(calls.length, 1);
  assert.deepEqual(storage.runs[1].transcripts, { added: 0, silent: 0 });
});

test("the transcript limit bounds one run; the rest wait for the next", async () => {
  const storage = fakeStorage();
  const calls = [];
  const transcribe = async (reels) => { calls.push(reels.map((r) => r.id)); return { results: reels.map((r) => ({ id: r.id, transcript: "x." })), usage: transcriptUsage }; };
  await runRefresh(deps(storage, transcribe, { transcriptLimit: 1 }));
  await runRefresh(deps(storage, transcribe, { transcriptLimit: 1 }));
  assert.deepEqual(calls, [["ig-loud"], ["ig-spoken"]]);
});

test("a failing transcript actor is logged on the run, the corpus stays and the collection counts", async () => {
  const storage = fakeStorage();
  const result = await runRefresh(deps(storage, async () => { throw new Error("transcript actor down"); }));
  assert.equal(result.recordsAdded, 3);
  const run = storage.runs[0];
  assert.equal(run.status, "partial");
  assert.deepEqual(run.errors, [{ creatorId: "transcripts", handle: "transcripts", message: "transcript actor down" }]);
  assert.equal(run.usage.unreported, 1);
  assert.equal(storage.signals.get("ig-loud").transcriptStatus, undefined);
});
