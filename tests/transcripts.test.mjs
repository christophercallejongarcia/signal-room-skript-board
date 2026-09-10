import test from "node:test";
import assert from "node:assert/strict";
import { boundedTranscriptError, isPendingTranscriptExpired, pickTranscriptBatch, resetLegacyTranscriptStatuses } from "../lib/transcripts.ts";

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

test("the combined score threshold selects a fast reel below the old outlier threshold", () => {
  const signals = [
    reel("fast", "a", 1500, { publishedAt: "2026-08-24T11:00:00.000Z" }),
    reel("slow", "b", 1900, { publishedAt: "2026-08-01T00:00:00.000Z" }),
    reel("post", "a", 5000, { format: "post" }),
  ];
  const batch = pickTranscriptBatch(signals, creators, {
    scoreThreshold: 30,
    limit: 10,
    now: new Date("2026-08-24T12:00:00.000Z"),
  });
  assert.deepEqual(batch.map((s) => s.id), ["fast"]);
});

test("a reel with a transcript or any assigned status is never picked again", () => {
  const signals = [
    reel("done", "a", 5000, { transcript: "Hallo.", transcriptStatus: "ready" }),
    reel("silent", "a", 5000, { transcriptStatus: "silent" }),
    reel("missing", "a", 5000, { transcriptStatus: "missing" }),
    reel("pending", "a", 5000, { transcriptStatus: "pending", transcriptUpdatedAt: "2026-08-20T00:00:00.000Z" }),
    reel("failed", "a", 5000, { transcriptStatus: "failed", transcriptError: "Actor down" }),
    reel("open", "a", 5000),
  ];
  const batch = pickTranscriptBatch(signals, creators, { scoreThreshold: 20, limit: 10 });
  assert.deepEqual(batch.map((s) => s.id), ["open"]);
});

test("a pending transcript expires only after the configured timeout", () => {
  const now = new Date("2026-08-20T00:10:00.000Z");
  const pending = { transcriptStatus: "pending", transcriptUpdatedAt: "2026-08-20T00:00:00.000Z" };
  assert.equal(isPendingTranscriptExpired(pending, now, 10 * 60_000), false);
  assert.equal(isPendingTranscriptExpired(pending, new Date("2026-08-20T00:10:01.000Z"), 10 * 60_000), true);
  assert.equal(isPendingTranscriptExpired({ ...pending, transcriptUpdatedAt: "2026-08-20T00:09:00.000Z" }, now, 10 * 60_000), false);
  assert.equal(isPendingTranscriptExpired({ transcriptStatus: "failed" }, now, 1), false);
});

test("transcript actor errors are collapsed and capped before they reach a Signal", () => {
  const message = boundedTranscriptError(new Error(`first line\n${"x".repeat(500)}`));
  assert.equal(message.startsWith("first line x"), true);
  assert.equal(message.length, 300);
});

test("the legacy silent and missing repair removes only empty final statuses and is idempotent", () => {
  const signals = [
    reel("silent", "a", 5000, { transcriptStatus: "silent" }),
    reel("missing", "a", 5000, { transcriptStatus: "missing", transcriptAttempts: 1 }),
    reel("real", "a", 5000, { transcriptStatus: "silent", transcript: "Tatsächlicher Text." }),
    reel("open", "a", 5000),
  ];
  const first = resetLegacyTranscriptStatuses(signals);
  assert.equal(first.reset, 2);
  assert.equal(first.signals.find((signal) => signal.id === "silent").transcriptStatus, undefined);
  assert.equal(first.signals.find((signal) => signal.id === "missing").transcriptStatus, undefined);
  assert.equal(first.signals.find((signal) => signal.id === "missing").transcriptAttempts, 1);
  assert.equal(first.signals.find((signal) => signal.id === "real").transcriptStatus, "silent");
  const second = resetLegacyTranscriptStatuses(first.signals);
  assert.equal(second.reset, 0);
});

test("strongest combined score first, cut at the limit; unknown creators and reels without url are skipped", () => {
  const sortCreators = [
    ...creators.map((creator) => creator.id === "b" ? { ...creator, audience: 1000 } : creator),
    { id: "c", name: "Cleo", handle: "@cleo", network: "instagram", audience: 1000, accent: "#000" },
    { id: "d", name: "Dani", handle: "@dani", network: "instagram", audience: 1000, accent: "#000" },
  ];
  const signals = [
    reel("old-high", "a", 6000, { publishedAt: "2026-07-01T00:00:00.000Z" }),
    reel("fresh-lower", "b", 5000, { publishedAt: "2026-08-24T11:00:00.000Z" }),
    reel("middle", "c", 4000, { publishedAt: "2026-08-23T12:00:00.000Z" }),
    reel("ghost", "zzz", 90000),
    reel("nourl", "d", 90000, { url: undefined }),
  ];
  const batch = pickTranscriptBatch(signals, sortCreators, {
    scoreThreshold: 20,
    limit: 2,
    now: new Date("2026-08-24T12:00:00.000Z"),
  });
  assert.deepEqual(batch.map((s) => s.id), ["fresh-lower", "old-high"]);
});

test("german reels take the transcript budget before any english-market reel", () => {
  const marketCreators = [
    ...creators,
    { id: "en", name: "Eng", handle: "@eng", network: "instagram", audience: 1000, accent: "#000", market: "en" },
  ];
  const signals = [
    reel("en-strong", "en", 90000, { publishedAt: "2026-08-24T11:00:00.000Z" }),
    reel("de-weaker", "a", 1500, { publishedAt: "2026-08-24T11:00:00.000Z" }),
    reel("en-second", "en", 80000, { publishedAt: "2026-08-24T11:00:00.000Z" }),
  ];
  const batch = pickTranscriptBatch(signals, marketCreators, {
    scoreThreshold: 20,
    limit: 2,
    now: new Date("2026-08-24T12:00:00.000Z"),
  });
  assert.deepEqual(batch.map((s) => s.id), ["de-weaker", "en-strong"], "the weaker german reel still goes first, english fills the rest");
});
