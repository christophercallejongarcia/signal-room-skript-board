import test from "node:test";
import assert from "node:assert/strict";
import { runBriefing } from "../lib/briefing-run.ts";

const creators = [{ id: "big", name: "Big", handle: "@big", network: "instagram", audience: 200_000, accent: "#000" }];
const signals = [{
  id: "s1", externalId: "abc", creatorId: "big", title: "Reel 1", caption: "Reel 1", publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
  views: 900_000, plays: 900_000, likes: 10, comments: 2, durationSeconds: 30, thumbnailSeed: "s", topic: "t", format: "reel", url: "https://www.instagram.com/reel/1/",
}];

function fakeStorage() {
  const saved = [];
  return { saved, async listCreators() { return creators; }, async listSignals() { return signals; }, async saveBriefing(b) { saved.push(b); } };
}

test("the cron's briefing is written without angles and never calls the Bridge or the disk", async () => {
  const storage = fakeStorage();
  const originalFetch = globalThis.fetch;
  let bridgeCalls = 0;
  globalThis.fetch = async () => { bridgeCalls += 1; throw new Error("no Bridge here"); };
  try {
    const briefing = await runBriefing({ storage, withCovers: async (records) => records, angles: false });
    assert.equal(briefing.items.length, 1);
    assert.equal(briefing.angles, false);
    assert.equal(briefing.items[0].coverUrl, undefined);
    assert.equal(bridgeCalls, 0);
    assert.deepEqual(storage.saved, [briefing]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the local refresh still asks the Bridge and keeps the list when it is down", async () => {
  const storage = fakeStorage();
  const originalFetch = globalThis.fetch;
  let bridgeCalls = 0;
  globalThis.fetch = async () => { bridgeCalls += 1; throw new Error("bridge down"); };
  try {
    const briefing = await runBriefing({ storage, withCovers: async (records) => records });
    assert.equal(bridgeCalls, 1);
    assert.equal(briefing.angles, false);
    assert.equal(storage.saved.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
