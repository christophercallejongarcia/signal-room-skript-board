import test from "node:test";
import assert from "node:assert/strict";
import { mergeSignals, refreshWindowSince, OVERLAP_DAYS } from "../lib/refresh-window.ts";

const creator = { id: "instagram-a", name: "A", handle: "@a", network: "instagram", audience: 1000, accent: "#fff" };

test("first run asks for the backfill window", () => {
  assert.equal(refreshWindowSince(creator), "90 days");
});

test("delta run asks from lastCheckedAt minus one day of overlap", () => {
  assert.equal(OVERLAP_DAYS, 1);
  assert.equal(refreshWindowSince({ ...creator, lastCheckedAt: "2026-08-24T10:00:00.000Z" }), "2026-08-23");
});

test("overlap crosses month boundaries", () => {
  assert.equal(refreshWindowSince({ ...creator, lastCheckedAt: "2026-09-01T00:30:00.000Z" }), "2026-08-31");
});

test("invalid cursor falls back to the backfill window", () => {
  assert.equal(refreshWindowSince({ ...creator, lastCheckedAt: "not-a-date" }), "90 days");
});

const stored = [
  { id: "ig-a", externalId: "a", creatorId: "c", title: "old", publishedAt: "2026-08-01T00:00:00.000Z", views: 100, plays: 100, likes: 10, comments: 1, durationSeconds: 5, thumbnailSeed: "a", topic: "x", coverUrl: "/api/covers/a" },
  { id: "ig-b", externalId: "b", creatorId: "c", title: "b", publishedAt: "2026-08-02T00:00:00.000Z", views: 5, likes: 1, comments: 0, durationSeconds: 5, thumbnailSeed: "b", topic: "x" },
];

test("known reels get updated counters without duplicates", () => {
  const incoming = [{ ...stored[0], title: "old", views: 250, plays: 250, likes: 40, comments: 7, coverUrl: undefined }];
  const { signals, inserted, updated } = mergeSignals(stored, incoming);
  assert.equal(signals.length, 2);
  assert.equal(inserted, 0);
  assert.equal(updated, 1);
  const a = signals.find((s) => s.id === "ig-a");
  assert.equal(a.plays, 250);
  assert.equal(a.likes, 40);
  assert.equal(a.comments, 7);
  assert.equal(a.coverUrl, "/api/covers/a", "fields missing in the incoming record are kept");
});

test("new reels are inserted and counted", () => {
  const incoming = [{ ...stored[1], id: "ig-n", externalId: "n" }];
  const { signals, inserted, updated } = mergeSignals(stored, incoming);
  assert.equal(signals.length, 3);
  assert.equal(inserted, 1);
  assert.equal(updated, 0);
});

test("the same batch twice inserts nothing", () => {
  const once = mergeSignals([], stored);
  assert.equal(once.inserted, 2);
  const twice = mergeSignals(once.signals, stored);
  assert.equal(twice.inserted, 0);
  assert.equal(twice.updated, 2);
  assert.equal(twice.signals.length, 2);
});

test("a duplicate inside one batch counts once", () => {
  const { signals, inserted, updated } = mergeSignals([], [stored[0], { ...stored[0], likes: 99 }]);
  assert.equal(signals.length, 1);
  assert.equal(inserted, 1);
  assert.equal(updated, 0);
  assert.equal(signals[0].likes, 99);
});
