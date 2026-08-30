import test from "node:test";
import assert from "node:assert/strict";
import { regenerateStart, runSlate } from "../lib/slate-run.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-30T08:00:00.000Z");

const creators = [{ id: "big", name: "Big", handle: "@big", network: "instagram", audience: 200_000, accent: "#000" }];
function reel(id, hoursAgo) {
  return {
    id, externalId: id, creatorId: "big", title: `Reel ${id}`, caption: `Reel ${id}`, publishedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    views: 900_000, plays: 900_000, likes: 10, comments: 2, durationSeconds: 30, thumbnailSeed: "s", topic: "t", format: "reel", url: `https://www.instagram.com/reel/${id}/`,
  };
}
const signals = [reel("s1", 1), reel("s2", 2)];

function fakeStorage(slates = []) {
  const store = { slates: [...slates] };
  return {
    store,
    async listCreators() { return creators; },
    async listSignals() { return signals; },
    async listSlates(limit = 14) { return [...store.slates].sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit); },
    async saveSlate(slate) { store.slates = [slate, ...store.slates.filter((s) => s.id !== slate.id)]; },
  };
}

/** A Bridge that answers count starts, all from source 1, and records what it was asked. */
function fakeBridge(answer) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (answer instanceof Error) throw answer;
    const payload = answer ?? {
      starts: Array.from({ length: body.count }, (_, i) => ({ pitch: `Start ${i + 1}`, topic: `Thema ${i + 1}`, source: 1 })),
    };
    return { ok: true, json: async () => payload };
  };
  return { calls, fetch };
}

async function withFetch(fetch, work) {
  const original = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
  }
}

test("a run writes the day's slate with ten starts read from the window", async () => {
  const storage = fakeStorage();
  const bridge = fakeBridge();
  const slate = await withFetch(bridge.fetch, () => runSlate({ storage, now: NOW }));

  assert.equal(slate.id, "slate-2026-08-30");
  assert.equal(slate.starts.length, 10);
  assert.equal(slate.sources, 2);
  assert.equal(slate.starts[0].sourceSignalId, "s1");
  assert.equal(bridge.calls.length, 1);
  assert.match(bridge.calls[0].url, /\/v1\/slate$/);
  assert.equal(bridge.calls[0].body.count, 10);
  assert.equal(bridge.calls[0].body.evidence.length, 2);
  assert.deepEqual(storage.store.slates, [slate]);
});

test("a second run on the same day finds the slate and leaves it alone", async () => {
  const storage = fakeStorage();
  const bridge = fakeBridge();
  const first = await withFetch(bridge.fetch, () => runSlate({ storage, now: NOW }));
  const second = await withFetch(bridge.fetch, () => runSlate({ storage, now: NOW + 3 * HOUR }));

  assert.deepEqual(second, first);
  assert.equal(bridge.calls.length, 1);
  assert.equal(storage.store.slates.length, 1);
});

test("force rebuilds the day's slate, keeping the direction that was on it", async () => {
  const storage = fakeStorage();
  const bridge = fakeBridge();
  const first = await withFetch(bridge.fetch, () => runSlate({ storage, now: NOW }));
  await storage.saveSlate({ ...first, direction: "mehr Werkzeug" });
  const rebuilt = await withFetch(bridge.fetch, () => runSlate({ storage, now: NOW + HOUR, force: true }));

  assert.equal(bridge.calls.length, 2);
  assert.equal(bridge.calls[1].body.direction, "mehr Werkzeug");
  assert.equal(rebuilt.direction, "mehr Werkzeug");
  assert.equal(rebuilt.directionApplied, "mehr Werkzeug");
  assert.equal(storage.store.slates.length, 1);
});

test("the direction stored yesterday reaches today's run", async () => {
  const storage = fakeStorage();
  const bridge = fakeBridge();
  const yesterday = await withFetch(bridge.fetch, () => runSlate({ storage, now: NOW - 24 * HOUR }));
  await storage.saveSlate({ ...yesterday, direction: "weniger Meinung" });
  const today = await withFetch(bridge.fetch, () => runSlate({ storage, now: NOW }));

  assert.equal(today.id, "slate-2026-08-30");
  assert.equal(bridge.calls[1].body.direction, "weniger Meinung");
  assert.equal(today.direction, "weniger Meinung");
  assert.equal(today.directionApplied, "weniger Meinung");
  assert.equal(storage.store.slates.length, 2);
});

test("a window without a reel writes an empty slate and never calls the Bridge", async () => {
  const storage = fakeStorage();
  storage.listSignals = async () => [];
  const bridge = fakeBridge();
  const slate = await withFetch(bridge.fetch, () => runSlate({ storage, now: NOW }));

  assert.deepEqual(slate.starts, []);
  assert.equal(slate.sources, 0);
  assert.equal(bridge.calls.length, 0);
  assert.equal(storage.store.slates.length, 1);
});

test("a Bridge that fails leaves no slate behind: the slate is the document, not a garnish", async () => {
  const storage = fakeStorage();
  const bridge = fakeBridge(new Error("bridge down"));
  await assert.rejects(withFetch(bridge.fetch, () => runSlate({ storage, now: NOW })), /bridge down/);
  assert.equal(storage.store.slates.length, 0);
});

test("an answer with the wrong number of starts is refused and nothing is written", async () => {
  const storage = fakeStorage();
  const bridge = fakeBridge({ starts: [{ pitch: "one", topic: "t", source: 1 }] });
  await assert.rejects(withFetch(bridge.fetch, () => runSlate({ storage, now: NOW })), /exactly 10/);
  assert.equal(storage.store.slates.length, 0);
});

test("regenerating one position asks for one start, hands over the other pitches and the direction, and keeps the rest", async () => {
  const storage = fakeStorage();
  const bridge = fakeBridge();
  const slate = await withFetch(bridge.fetch, () => runSlate({ storage, now: NOW }));
  await storage.saveSlate({ ...slate, direction: "mehr Werkzeug" });

  const one = fakeBridge({ starts: [{ pitch: "Neu", topic: "Werkzeug", source: 2 }] });
  const next = await withFetch(one.fetch, () => regenerateStart(slate.id, 4, { storage, now: NOW + 2 * HOUR }));

  assert.equal(one.calls.length, 1);
  assert.equal(one.calls[0].body.count, 1);
  assert.equal(one.calls[0].body.direction, "mehr Werkzeug");
  assert.equal(one.calls[0].body.taken.length, 9);
  assert.ok(!one.calls[0].body.taken.includes("Start 4"));
  assert.equal(next.starts[3].pitch, "Neu");
  assert.equal(next.starts[3].position, 4);
  assert.equal(next.starts[3].sourceSignalId, "s2");
  assert.ok(next.starts[3].regeneratedAt);
  assert.deepEqual(next.starts.filter((_, i) => i !== 3), slate.starts.filter((_, i) => i !== 3));
  assert.equal(next.directionApplied, "mehr Werkzeug");
  assert.deepEqual(storage.store.slates, [next]);
});

test("regenerating on an unknown slate or position is refused before the Bridge is asked", async () => {
  const storage = fakeStorage();
  const bridge = fakeBridge();
  const slate = await withFetch(bridge.fetch, () => runSlate({ storage, now: NOW }));
  assert.equal(await withFetch(bridge.fetch, () => regenerateStart("slate-1999-01-01", 1, { storage, now: NOW })), null);
  await assert.rejects(withFetch(bridge.fetch, () => regenerateStart(slate.id, 11, { storage, now: NOW })), /position 11/);
  assert.equal(bridge.calls.length, 1);
});
