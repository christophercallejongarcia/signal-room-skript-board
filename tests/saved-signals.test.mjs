import test from "node:test";
import assert from "node:assert/strict";
import { OUTLIER_THRESHOLDS, countSaved, filterDiscover, isSaved } from "../lib/discover-filter.ts";
import { parseSignalMark } from "../lib/signal-mark.ts";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const DAY = 86_400_000;

const creators = [
  { id: "a", name: "A", handle: "@a", network: "instagram", audience: 1000, accent: "#000" },
  { id: "b", name: "B", handle: "@b", network: "instagram", audience: 1000, accent: "#000" },
  { id: "mine", name: "Mine", handle: "@mine", network: "instagram", audience: 1000, accent: "#000", owned: true },
  { id: "y", name: "Y", handle: "@y", network: "youtube", audience: 1000, accent: "#000" },
];

function sig(id, creatorId, outlier, daysAgo, savedAt) {
  return {
    id, creatorId, title: id, publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    views: 0, likes: 0, comments: 0, durationSeconds: 10, thumbnailSeed: "s", topic: "t",
    score: 0, relativeReach: 0, velocity: 0, reason: "", outlier, channelRelative: 0,
    ...(savedAt ? { savedAt } : {}),
  };
}

const signals = [
  sig("s1", "a", 2.5, 1, "2026-08-23T10:00:00.000Z"),
  sig("s2", "a", 1.6, 5),
  sig("s3", "b", 3.2, 40, "2026-08-20T10:00:00.000Z"),
  sig("s4", "b", 0.4, 2, "2026-08-23T11:00:00.000Z"),
  sig("s5", "mine", 9, 1, "2026-08-23T12:00:00.000Z"),
  sig("s6", "y", 9, 1, "2026-08-23T12:00:00.000Z"),
];

test("isSaved reads the mark, absent means not saved", () => {
  assert.equal(isSaved(signals[0]), true);
  assert.equal(isSaved(signals[1]), false);
  assert.equal(isSaved({}), false);
  assert.equal(isSaved({ savedAt: "" }), false);
});

test("saved view shows exactly the saved signals and keeps the scope filters", () => {
  const base = { network: "instagram", creatorId: "all", published: "all", now: NOW, threshold: 2, view: "saved" };
  const ids = (filters) => filterDiscover(signals, creators, { ...base, ...filters }).map((s) => s.id);
  assert.deepEqual(ids({}), ["s1", "s3", "s4"]);
  assert.deepEqual(ids({ published: "7" }), ["s1", "s4"]);
  assert.deepEqual(ids({ creatorId: "b" }), ["s3", "s4"]);
  assert.deepEqual(ids({ network: "youtube" }), ["s6"]);
  // The threshold is an outlier filter, not a saved filter: a saved 0.4x stays.
  assert.deepEqual(ids({ threshold: 5 }), ["s1", "s3", "s4"]);
});

test("stat count equals saved-view card count for every filter combination", () => {
  for (const network of ["instagram", "youtube"]) {
    for (const creatorId of ["all", "a", "b"]) {
      for (const published of ["7", "30", "90", "all"]) {
        for (const threshold of OUTLIER_THRESHOLDS) {
          const filters = { network, creatorId, published, now: NOW, threshold };
          const cards = filterDiscover(signals, creators, { ...filters, view: "saved" });
          assert.equal(countSaved(signals, creators, filters), cards.length, JSON.stringify(filters));
        }
      }
    }
  }
});

test("parseSignalMark reads id and saved", () => {
  assert.deepEqual(parseSignalMark({ id: " s1 ", saved: true }), { id: "s1", saved: true });
  assert.deepEqual(parseSignalMark({ id: "s1", saved: false }), { id: "s1", saved: false });
});

test("parseSignalMark rejects a missing id and a non-boolean saved", () => {
  assert.throws(() => parseSignalMark({ saved: true }), /id required/);
  assert.throws(() => parseSignalMark({ id: "   ", saved: true }), /id required/);
  assert.throws(() => parseSignalMark({ id: "s1" }), /saved must be true or false/);
  assert.throws(() => parseSignalMark({ id: "s1", saved: "yes" }), /saved must be true or false/);
  assert.throws(() => parseSignalMark(null), /id required/);
});
