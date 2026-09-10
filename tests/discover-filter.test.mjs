import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OUTLIER_THRESHOLD,
  OUTLIER_THRESHOLDS,
  countOutliers,
  filterDiscover,
  isOutlier,
  sortDiscover,
  storeOrDemo,
} from "../lib/discover-filter.ts";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const DAY = 86_400_000;

const creators = [
  { id: "a", name: "A", handle: "@a", network: "instagram", audience: 1000, accent: "#000" },
  { id: "b", name: "B", handle: "@b", network: "instagram", audience: 1000, accent: "#000" },
  { id: "y", name: "Y", handle: "@y", network: "youtube", audience: 1000, accent: "#000" },
];

function sig(id, creatorId, outlier, daysAgo) {
  return {
    id, creatorId, title: id, publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    views: 0, likes: 0, comments: 0, durationSeconds: 10, thumbnailSeed: "s", topic: "t",
    score: 0, relativeReach: 0, velocity: 0, reason: "", outlier, channelRelative: 0,
  };
}

const signals = [
  sig("s1", "a", 2.5, 1),
  sig("s2", "a", 1.6, 5),
  sig("s3", "b", 3.2, 40),
  sig("s4", "b", 0.4, 2),
  sig("s5", "y", 9, 1),
];

test("Discover sorts the complete filtered corpus by multiplier in either direction without changing its input", () => {
  const filters = { network: "instagram", creatorId: "all", published: "all", now: NOW, threshold: 1.5, view: "outliers" };
  const matches = filterDiscover(signals, creators, filters);
  assert.deepEqual(sortDiscover(matches, "outlier").map((s) => s.id), ["s3", "s1", "s2"]);
  assert.deepEqual(sortDiscover(matches, "outlier-asc").map((s) => s.id), ["s2", "s1", "s3"]);
  assert.deepEqual(matches.map((s) => s.id), ["s1", "s2", "s3"]);
});

test("Discover orders equal multipliers by date then canonical id, independently of input order", () => {
  const tied = [sig("z", "a", 3, 1), sig("old", "a", 3, 2), sig("a", "a", 3, 1)];
  for (const sort of ["outlier", "outlier-asc"]) {
    assert.deepEqual(sortDiscover(tied, sort).map((s) => s.id), ["a", "z", "old"]);
    assert.deepEqual(sortDiscover([...tied].reverse(), sort).map((s) => s.id), ["a", "z", "old"]);
  }
});

test("Discover sorts dates and plays in both directions, falling back to views and keeping zero plays", () => {
  const items = [
    { ...sig("fallback", "a", 2, 3), views: 30 },
    { ...sig("zero", "a", 2, 1), plays: 0, views: 100 },
    { ...sig("plays", "a", 2, 2), plays: 50, views: 1 },
  ];
  assert.deepEqual(sortDiscover(items, "newest").map((s) => s.id), ["zero", "plays", "fallback"]);
  assert.deepEqual(sortDiscover(items, "oldest").map((s) => s.id), ["fallback", "plays", "zero"]);
  assert.deepEqual(sortDiscover(items, "views").map((s) => s.id), ["plays", "fallback", "zero"]);
  assert.deepEqual(sortDiscover(items, "views-asc").map((s) => s.id), ["zero", "fallback", "plays"]);
  assert.deepEqual(sortDiscover([], "outlier"), []);
});

test("Discover keeps all 236 outliers available, including the strongest signal beyond the first 48", () => {
  const corpus = Array.from({ length: 236 }, (_, index) => sig(`reel-${index}`, "a", index + 2, 1));
  const matches = filterDiscover(corpus, creators, {
    network: "instagram", creatorId: "all", published: "all", now: NOW, threshold: 2, view: "outliers",
  });
  const sorted = sortDiscover(matches, "outlier");
  assert.equal(sorted.length, 236);
  assert.equal(new Set(sorted.map((s) => s.id)).size, 236);
  assert.equal(sorted[0].id, "reel-235");
  assert.equal(sorted.at(-1).id, "reel-0");
});

test("thresholds expose 1.5x, 2x, 3x, 5x with 2x as default", () => {
  assert.deepEqual(OUTLIER_THRESHOLDS, [1.5, 2, 3, 5]);
  assert.equal(DEFAULT_OUTLIER_THRESHOLD, 2);
});

test("isOutlier compares against the given threshold", () => {
  assert.equal(isOutlier({ outlier: 2 }, 2), true);
  assert.equal(isOutlier({ outlier: 1.99 }, 2), false);
  assert.equal(isOutlier({ outlier: 1.6 }, 1.5), true);
  assert.equal(isOutlier({}, 2), false);
});

test("stat count equals outlier-view card count for every filter combination", () => {
  const creatorIds = ["all", "a", "b"];
  const windows = ["7", "30", "90", "all"];
  for (const network of ["instagram", "youtube"]) {
    for (const creatorId of creatorIds) {
      for (const published of windows) {
        for (const threshold of OUTLIER_THRESHOLDS) {
          const filters = { network, creatorId, published, now: NOW, threshold };
          const cards = filterDiscover(signals, creators, { ...filters, view: "outliers" });
          assert.equal(countOutliers(signals, creators, filters), cards.length, JSON.stringify(filters));
        }
      }
    }
  }
});

test("outlier view respects threshold, window, channel and network", () => {
  const base = { network: "instagram", creatorId: "all", published: "all", now: NOW };
  assert.deepEqual(filterDiscover(signals, creators, { ...base, view: "outliers", threshold: 2 }).map((s) => s.id), ["s1", "s3"]);
  assert.deepEqual(filterDiscover(signals, creators, { ...base, view: "outliers", threshold: 1.5 }).map((s) => s.id), ["s1", "s2", "s3"]);
  assert.deepEqual(filterDiscover(signals, creators, { ...base, view: "outliers", threshold: 1.5, published: "7" }).map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(filterDiscover(signals, creators, { ...base, view: "outliers", threshold: 1.5, creatorId: "b" }).map((s) => s.id), ["s3"]);
  assert.deepEqual(filterDiscover(signals, creators, { ...base, view: "all", threshold: 5 }).map((s) => s.id), ["s1", "s2", "s3", "s4"]);
  assert.deepEqual(filterDiscover(signals, creators, { ...base, view: "saved", threshold: 2 }), []);
});

test("real creators replace demo fixtures entirely; empty store keeps demo", () => {
  const demo = { creators: [creators[2]], signals: [signals[4]] };
  const real = { creators: [creators[0]], signals: [signals[0]] };
  assert.equal(storeOrDemo(real, demo), real);
  assert.equal(storeOrDemo({ creators: [], signals: [] }, demo), demo);
});
