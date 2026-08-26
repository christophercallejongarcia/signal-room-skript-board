import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATOR_SORTS,
  creatorPath,
  creatorSignals,
  creatorStats,
  parseThreshold,
  sortCreatorSignals,
  tabPath,
} from "../lib/creator-detail.ts";

/** One creator's retained corpus. Reach is plays, except for the record that has none. */
const reels = [
  { id: "r1", creatorId: "a", publishedAt: "2026-08-01T00:00:00.000Z", views: 900, plays: 1000, outlier: 1 },
  { id: "r2", creatorId: "a", publishedAt: "2026-08-10T00:00:00.000Z", views: 4000, plays: 4000, outlier: 4 },
  { id: "r3", creatorId: "a", publishedAt: "2026-08-05T00:00:00.000Z", views: 2500, outlier: 2.5 },
  { id: "r4", creatorId: "b", publishedAt: "2026-08-20T00:00:00.000Z", views: 99, plays: 99, outlier: 9 },
];

const mine = reels.filter((reel) => reel.creatorId === "a");

test("creatorSignals keeps one creator, newest first", () => {
  assert.deepEqual(creatorSignals(reels, "a").map((reel) => reel.id), ["r2", "r3", "r1"]);
  assert.deepEqual(creatorSignals(reels, "missing"), []);
});

test("creatorStats sums reach, falling back to views when a record has no plays", () => {
  assert.equal(creatorStats(mine).views, 7500);
});

test("creatorStats averages the outlier over the retained corpus", () => {
  assert.equal(creatorStats(mine).averageOutlier, 2.5);
});

test("creatorStats reports the strongest outlier and the retained count", () => {
  const stats = creatorStats(mine);
  assert.equal(stats.strongestOutlier, 4);
  assert.equal(stats.retained, 3);
});

test("creatorStats treats a missing outlier as zero rather than dropping the reel", () => {
  const stats = creatorStats([
    { publishedAt: "2026-08-01T00:00:00.000Z", views: 100 },
    { publishedAt: "2026-08-02T00:00:00.000Z", views: 100, outlier: 2 },
  ]);
  assert.equal(stats.averageOutlier, 1);
  assert.equal(stats.strongestOutlier, 2);
});

test("creatorStats reports no averages for an empty corpus instead of a confident zero", () => {
  assert.deepEqual(creatorStats([]), { views: 0, retained: 0, averageOutlier: null, strongestOutlier: null });
});

test("sortCreatorSignals orders by every column in both directions", () => {
  const ids = (sort, direction) => sortCreatorSignals(mine, { sort, direction }).map((reel) => reel.id);
  assert.deepEqual(ids("published", "desc"), ["r2", "r3", "r1"]);
  assert.deepEqual(ids("published", "asc"), ["r1", "r3", "r2"]);
  assert.deepEqual(ids("plays", "desc"), ["r2", "r3", "r1"]);
  assert.deepEqual(ids("plays", "asc"), ["r1", "r3", "r2"]);
  assert.deepEqual(ids("outlier", "desc"), ["r2", "r3", "r1"]);
  assert.deepEqual(ids("outlier", "asc"), ["r1", "r3", "r2"]);
});

test("sortCreatorSignals breaks a tie by date, newest first, and leaves the input alone", () => {
  const tied = [
    { id: "old", publishedAt: "2026-08-01T00:00:00.000Z", views: 100, outlier: 2 },
    { id: "new", publishedAt: "2026-08-09T00:00:00.000Z", views: 100, outlier: 2 },
  ];
  assert.deepEqual(sortCreatorSignals(tied, { sort: "outlier", direction: "desc" }).map((reel) => reel.id), ["new", "old"]);
  assert.deepEqual(sortCreatorSignals(tied, { sort: "plays", direction: "asc" }).map((reel) => reel.id), ["new", "old"]);
  assert.deepEqual(tied.map((reel) => reel.id), ["old", "new"]);
});

test("CREATOR_SORTS carries the three sortable columns", () => {
  assert.deepEqual([...CREATOR_SORTS], ["published", "plays", "outlier"]);
});

test("creatorPath escapes the id so a handle with a slash cannot leave the route", () => {
  assert.equal(creatorPath("instagram-denizdeke"), "/creator/instagram-denizdeke");
  assert.equal(creatorPath("a/b"), "/creator/a%2Fb");
});

test("creatorPath carries the origin tab and the threshold the desk was reading at", () => {
  assert.equal(creatorPath("a", { from: "discover", threshold: 5 }), "/creator/a?from=discover&threshold=5");
  assert.equal(creatorPath("a", { from: "channels" }), "/creator/a?from=channels");
});

test("tabPath returns the desk on one tab", () => {
  assert.equal(tabPath("channels"), "/?tab=channels");
});

test("parseThreshold takes a selectable threshold and refuses anything else", () => {
  assert.equal(parseThreshold("?threshold=5", 2), 5);
  assert.equal(parseThreshold("?threshold=1.5", 2), 1.5);
  assert.equal(parseThreshold("?threshold=99", 2), 2);
  assert.equal(parseThreshold("?threshold=abc", 2), 2);
  assert.equal(parseThreshold("", 2), 2);
});
