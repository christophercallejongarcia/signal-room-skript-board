import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPTION_EXCERPT_LENGTH,
  captionExcerpt,
  selectEvidence,
} from "../lib/strategy-evidence.ts";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const DAY = 86_400_000;

const creators = [
  { id: "a", name: "Ada", handle: "@ada", network: "instagram", audience: 1000, accent: "#000" },
  { id: "b", name: "Ben", handle: "@ben", network: "instagram", audience: 2000, accent: "#000" },
];

function reel(id, creatorId, outlier, daysAgo, extra = {}) {
  return {
    id,
    creatorId,
    title: `Reel ${id}`,
    publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    views: 0,
    likes: 0,
    comments: 0,
    durationSeconds: 30,
    thumbnailSeed: id,
    topic: "ai workflows",
    plays: Math.round(outlier * 1000),
    caption: `Caption for ${id}`,
    format: "reel",
    score: 0,
    relativeReach: outlier,
    velocity: 0,
    reason: "",
    outlier,
    channelRelative: 1,
    ...extra,
  };
}

const options = { now: NOW, windowDays: 30, threshold: 2, limit: 3 };

test("takes the strongest outliers inside the window, ranked by outlier", () => {
  const signals = [
    reel("weak", "a", 2.5, 3),
    reel("strongest", "a", 9.1, 5),
    reel("middle", "b", 4.4, 12),
  ];

  const evidence = selectEvidence(signals, creators, options);

  assert.deepEqual(
    evidence.map((item) => item.title),
    ["Reel strongest", "Reel middle", "Reel weak"],
  );
});

test("keeps only the configured top N", () => {
  const signals = ["a", "b", "c", "d", "e"].map((id, index) => reel(id, "a", 9 - index, 1));
  assert.equal(selectEvidence(signals, creators, { ...options, limit: 2 }).length, 2);
});

test("drops signals published outside the window", () => {
  const signals = [reel("inside", "a", 3, 29), reel("outside", "a", 8, 31)];
  const evidence = selectEvidence(signals, creators, options);
  assert.deepEqual(evidence.map((item) => item.title), ["Reel inside"]);
});

test("drops signals below the threshold", () => {
  const signals = [reel("above", "a", 2, 1), reel("below", "a", 1.9, 1)];
  const evidence = selectEvidence(signals, creators, options);
  assert.deepEqual(evidence.map((item) => item.title), ["Reel above"]);
});

test("drops posts and signals without a known creator", () => {
  const signals = [
    reel("post", "a", 8, 1, { format: "post" }),
    reel("orphan", "ghost", 8, 1),
    reel("keeper", "a", 3, 1),
  ];
  const evidence = selectEvidence(signals, creators, options);
  assert.deepEqual(evidence.map((item) => item.title), ["Reel keeper"]);
});

test("carries title, creator handle, caption excerpt, plays and outlier", () => {
  const signals = [reel("one", "b", 4.5, 2, { plays: 9000, caption: "Zwei Zeilen\nUeber Beweise" })];
  const [item] = selectEvidence(signals, creators, options);

  assert.deepEqual(item, {
    title: "Reel one",
    creator: "@ben",
    caption: "Zwei Zeilen Ueber Beweise",
    plays: 9000,
    outlier: 4.5,
  });
});

test("ranks on the exact outlier, not the rounded one", () => {
  const signals = [reel("lower", "a", 7.96, 1, { plays: 900 }), reel("higher", "a", 8.04, 1, { plays: 100 })];
  const evidence = selectEvidence(signals, creators, { ...options, limit: 1 });
  assert.deepEqual(evidence.map((item) => item.title), ["Reel higher"]);
});

test("rounds the outlier factor to one decimal", () => {
  const signals = [reel("one", "a", 7.999391030233558, 1)];
  assert.equal(selectEvidence(signals, creators, options)[0].outlier, 8);
});

test("falls back to views when the source reports no plays", () => {
  const signals = [reel("one", "a", 3, 1, { plays: undefined, views: 4321 })];
  assert.equal(selectEvidence(signals, creators, options)[0].plays, 4321);
});

test("ties break on plays so the order is stable", () => {
  const signals = [reel("quiet", "a", 3, 1, { plays: 100 }), reel("loud", "a", 3, 1, { plays: 900 })];
  const evidence = selectEvidence(signals, creators, options);
  assert.deepEqual(evidence.map((item) => item.title), ["Reel loud", "Reel quiet"]);
});

test("caption excerpt collapses whitespace and stays bounded", () => {
  const long = "wort ".repeat(200);
  const excerpt = captionExcerpt(long);
  assert.ok(excerpt.length <= CAPTION_EXCERPT_LENGTH + 1);
  assert.equal(captionExcerpt("  a \n\n b  "), "a b");
  assert.equal(captionExcerpt(undefined), "");
});
