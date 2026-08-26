import test from "node:test";
import assert from "node:assert/strict";
import { filterDiscover, isOwned, withoutOwned } from "../lib/discover-filter.ts";
import { buildFormatSignals } from "../lib/format-signals.ts";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const DAY = 86_400_000;

const creators = [
  { id: "rival", name: "Rival", handle: "@rival", network: "instagram", audience: 1000, accent: "#000" },
  { id: "mine", name: "Mine", handle: "@mine", network: "instagram", audience: 1000, accent: "#000", owned: true },
];

function reel(id, creatorId, outlier, caption) {
  return {
    id, creatorId, title: caption, caption, publishedAt: new Date(NOW - DAY).toISOString(),
    views: 5000, plays: 5000, likes: 0, comments: 0, durationSeconds: 30, thumbnailSeed: "s",
    topic: "t", format: "reel", score: 0, relativeReach: 0, velocity: 0, reason: "",
    outlier, channelRelative: 1,
  };
}

const signals = [
  reel("s1", "rival", 4, "Die besten 3 Hooks"),
  reel("s2", "mine", 9, "Die besten 3 Hooks"),
];

test("isOwned reads the mark, absent means not owned", () => {
  assert.equal(isOwned(creators[1]), true);
  assert.equal(isOwned(creators[0]), false);
  assert.equal(isOwned(undefined), false);
});

test("withoutOwned drops every signal of an owned creator", () => {
  assert.deepEqual(withoutOwned(signals, creators).map((s) => s.id), ["s1"]);
});

test("withoutOwned keeps everything when no creator is owned", () => {
  const research = creators.map((creator) => ({ ...creator, owned: false }));
  assert.deepEqual(withoutOwned(signals, research).map((s) => s.id), ["s1", "s2"]);
});

test("withoutOwned keeps a signal whose creator is unknown", () => {
  const orphan = [reel("s3", "gone", 3, "Nie wieder Chaos")];
  assert.deepEqual(withoutOwned(orphan, creators).map((s) => s.id), ["s3"]);
});

test("Discover never shows an owned reel", () => {
  const filters = { network: "instagram", creatorId: "all", published: "all", now: NOW, threshold: 2, view: "all" };
  assert.deepEqual(filterDiscover(signals, creators, filters).map((s) => s.id), ["s1"]);
  assert.deepEqual(
    filterDiscover(signals, creators, { ...filters, view: "outliers" }).map((s) => s.id),
    ["s1"],
  );
});

test("Format Signals count owned reels in neither group", () => {
  const { own, foreign } = buildFormatSignals(signals, creators, { now: NOW, threshold: 2 });
  assert.equal(own.total, 1);
  assert.equal(foreign.total, 0);
  assert.equal(own.signals[0].count, 1);
  // The owned 9x reel would have doubled the average of the pattern it shares.
  assert.equal(own.signals[0].averageOutlier, 4);
});

test("an owned creator can also be foreign without landing in the foreign group", () => {
  const both = [creators[0], { ...creators[1], foreign: true }];
  const { own, foreign } = buildFormatSignals(signals, both, { now: NOW, threshold: 2 });
  assert.equal(own.total, 1);
  assert.equal(foreign.total, 0);
});
