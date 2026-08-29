import test from "node:test";
import assert from "node:assert/strict";
import { readTranscriptItems, transcribeReels, TRANSCRIPT_ACTOR } from "../lib/adapters/sources/apify-transcripts.ts";

const reels = [
  { id: "ig-AAA", externalId: "AAA", url: "https://www.instagram.com/p/AAA/" },
  { id: "ig-BBB", externalId: "BBB", url: "https://www.instagram.com/reel/BBB/" },
  { id: "ig-CCC", externalId: "CCC", url: "https://www.instagram.com/p/CCC/" },
];

test("items map back by the shortcode in any url field; empty text means silent; unanswered reels are left out", () => {
  const items = [
    { url: "https://www.instagram.com/reel/AAA/", transcript: "  Hallo zusammen. " },
    { inputUrl: "https://www.instagram.com/p/BBB/", transcript: "", segments: [] },
    { url: "https://www.instagram.com/p/ZZZ/", transcript: "fremd" },
  ];
  assert.deepEqual(readTranscriptItems(items, reels), [
    { id: "ig-AAA", transcript: "Hallo zusammen." },
    { id: "ig-BBB", transcript: null },
  ]);
});

test("segments are joined when there is no flat text field; a bare shortcode field also matches", () => {
  const items = [{ shortcode: "CCC", segments: [{ text: "Erster Satz." }, { text: " zweiter" }] }];
  assert.deepEqual(readTranscriptItems(items, reels), [{ id: "ig-CCC", transcript: "Erster Satz. zweiter" }]);
});

test("transcribeReels sends every url in one actor run and hands the usage on", async () => {
  const calls = [];
  const run = async (actor, input) => { calls.push([actor, input]); return { items: [{ url: reels[0].url, text: "Moin." }], usage: { costUsd: 0.02 } }; };
  const out = await transcribeReels(reels, run);
  assert.deepEqual(calls, [[TRANSCRIPT_ACTOR, { bulkUrls: reels.map((r) => r.url) }]]);
  assert.deepEqual(out, { results: [{ id: "ig-AAA", transcript: "Moin." }], usage: { unreported: 0, costUsd: 0.02 } });
});

test("no reels: no actor run, nothing to pay", async () => {
  const out = await transcribeReels([], async () => { throw new Error("must not run"); });
  assert.deepEqual(out, { results: [], usage: { unreported: 0 } });
});
