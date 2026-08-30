import test from "node:test";
import assert from "node:assert/strict";
import { pickTranscriptBatch } from "../lib/transcripts.ts";

const creators = [
  { id: "a", name: "Ada", handle: "@ada", network: "instagram", audience: 1000, accent: "#000" },
  { id: "b", name: "Ben", handle: "@ben", network: "instagram", audience: 2000, accent: "#000" },
];

function reel(id, creatorId, plays, extra = {}) {
  return {
    id,
    externalId: id,
    creatorId,
    title: `Reel ${id}`,
    publishedAt: "2026-08-20T00:00:00.000Z",
    views: 0,
    plays,
    likes: 0,
    comments: 0,
    durationSeconds: 30,
    thumbnailSeed: id,
    topic: "x",
    format: "reel",
    url: `https://www.instagram.com/p/${id}/`,
    ...extra,
  };
}

test("only reels at or above the threshold get a transcript", () => {
  const signals = [
    reel("over", "a", 2000),
    reel("under", "a", 1999),
    reel("post", "a", 5000, { format: "post" }),
  ];
  const batch = pickTranscriptBatch(signals, creators, { threshold: 2, limit: 10 });
  assert.deepEqual(batch.map((s) => s.id), ["over"]);
});

test("a reel with a transcript or marked silent is never picked again", () => {
  const signals = [
    reel("done", "a", 5000, { transcript: "Hallo.", transcriptStatus: "ready" }),
    reel("silent", "a", 5000, { transcriptStatus: "silent" }),
    reel("missing", "a", 5000, { transcriptStatus: "missing" }),
    reel("open", "a", 5000),
  ];
  const batch = pickTranscriptBatch(signals, creators, { threshold: 2, limit: 10 });
  assert.deepEqual(batch.map((s) => s.id), ["open"]);
});

test("strongest outlier first, cut at the limit; unknown creators and reels without url are skipped", () => {
  const signals = [
    reel("two", "a", 2000),
    reel("ten", "b", 20000),
    reel("five", "a", 5000),
    reel("ghost", "zzz", 90000),
    reel("nourl", "a", 90000, { url: undefined }),
  ];
  const batch = pickTranscriptBatch(signals, creators, { threshold: 2, limit: 2 });
  assert.deepEqual(batch.map((s) => s.id), ["ten", "five"]);
});
