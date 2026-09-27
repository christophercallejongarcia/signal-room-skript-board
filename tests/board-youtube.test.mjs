import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseTrack, chunkText, median, outlierFactor, vttToText } from "../lib/board/youtube.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "sr-board-yt-home-"));
process.env.SIGNAL_ROOM_BOARD_HOME = home;
process.env.BOARD_YTDLP_FAKE = "1";
const { fetchYoutube, IngestQueue, QueueFullError, metadataArgs } = await import("../bridge/board/youtube.mjs");

test("track choice: manual German, manual English, then the original-language auto track, never an auto translation", () => {
  assert.deepEqual(chooseTrack({ subtitles: { de: [], en: [] }, automatic_captions: {} }), { lang: "de", automatic: false, source: "manuell-de" });
  assert.deepEqual(chooseTrack({ subtitles: { "en-GB": [] } }), { lang: "en-GB", automatic: false, source: "manuell-en" });
  assert.deepEqual(chooseTrack({ language: "de-DE", automatic_captions: { en: [], "de-orig": [], de: [] } }), { lang: "de-orig", automatic: true, source: "auto-de" });
  assert.deepEqual(chooseTrack({ language: "en-US", automatic_captions: { en: [], "en-orig": [], de: [] } }), { lang: "en-orig", automatic: true, source: "auto-en" });
  assert.equal(chooseTrack({ language: "fr", automatic_captions: { "fr-orig": [], de: [] } }), null, "a French video's auto German is a translation");
  assert.equal(chooseTrack({ automatic_captions: {} }), null);
  assert.equal(chooseTrack({ subtitles: { live_chat: [] } }), null);
});

test("VTT becomes running text without timestamps, tags or repeated cue lines", () => {
  const vtt = [
    "WEBVTT",
    "Kind: captions",
    "Language: de",
    "",
    "00:00:00.080 --> 00:00:01.870 align:start position:0%",
    "Das<00:00:00.240><c> reine</c> Bedienen",
    "",
    "00:00:01.870 --> 00:00:01.880",
    "Das reine Bedienen",
    "",
    "2",
    "00:00:01.880 --> 00:00:03.510",
    "Das reine Bedienen",
    "stirbt &amp; geht.",
  ].join("\n");
  assert.equal(vttToText(vtt), "Das reine Bedienen stirbt & geht.");
});

test("median, factor and byte-safe chunks", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(outlierFactor(392_601, 51_000), 7.7);
  assert.equal(outlierFactor(100, 0), undefined);
  const chunks = chunkText("ä".repeat(10) + "😀".repeat(3), 8);
  assert.ok(chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 8));
  assert.equal(chunks.join(""), "ä".repeat(10) + "😀".repeat(3));
  assert.deepEqual(chunkText("", 8), [""]);
});

const queue = () => new IngestQueue({ maxWaiting: 20, pollMs: 20 });

test("fake yt-dlp: German video with de-orig track, metadata and channel views", async () => {
  const log = path.join(home, "argv.jsonl");
  process.env.FAKE_YTDLP_LOG = log;
  const result = await fetchYoutube({ videoId: "DR60qPkDM2o", withChannel: true, queue: queue(), instanceId: "test" });
  assert.equal(result.transcript.source, "auto-de");
  assert.match(result.transcript.text, /^Das reine Bedienen von Software stirbt gerade aus/);
  assert.equal(result.meta.views, 392_600);
  assert.equal(result.channelViews.length, 30);
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line).argv).filter(Boolean);
  const videoCalls = calls.filter((argv) => !argv.includes("--flat-playlist"));
  assert.equal(videoCalls.length, 2);
  for (const argv of videoCalls) {
    assert.ok(argv.includes("--no-playlist") && argv.includes("--ignore-config") && argv.includes("--no-cache-dir"));
    assert.equal(argv.at(-1), "https://www.youtube.com/watch?v=DR60qPkDM2o");
  }
  delete process.env.FAKE_YTDLP_LOG;
  assert.deepEqual(metadataArgs("DR60qPkDM2o", "/tmp/x").slice(-1), ["https://www.youtube.com/watch?v=DR60qPkDM2o"]);
});

test("fake yt-dlp: English video takes en-orig, not the auto-translated German", async () => {
  const result = await fetchYoutube({ videoId: "ENabcdefghi", queue: queue(), instanceId: "test" });
  assert.equal(result.transcript.source, "auto-en");
  assert.equal(result.transcript.text, "Welcome to the fake video. It has two lines.");
});

test("fake yt-dlp: no captions, exit ≠ 0, timeout and oversized output", async () => {
  const noCaps = await fetchYoutube({ videoId: "NOCAPS12345", queue: queue(), instanceId: "test" });
  assert.equal(noCaps.noCaptions, true);
  assert.equal(noCaps.transcript, null);
  await assert.rejects(fetchYoutube({ videoId: "FAILxxxxxxx", queue: queue(), instanceId: "test" }), (error) => error.status === 502 && /Video unavailable/.test(error.message));
  await assert.rejects(fetchYoutube({ videoId: "HUGExxxxxxx", queue: queue(), instanceId: "test" }), (error) => error.code === "overflow");
  process.env.BOARD_YTDLP_TIMEOUT_MS = "400";
  await assert.rejects(fetchYoutube({ videoId: "HANGxxxxxxx", queue: queue(), instanceId: "test" }), (error) => error.status === 504);
  delete process.env.BOARD_YTDLP_TIMEOUT_MS;
  await assert.rejects(fetchYoutube({ videoId: "../etc/pwd", queue: queue(), instanceId: "test" }), (error) => error.status === 400);
  const leftovers = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("sr-board-test-yt-"));
  assert.deepEqual(leftovers, [], "temp folders are removed");
});

test("the waiting room refuses more than its limit with 429", async () => {
  const small = new IngestQueue({ maxWaiting: 0, pollMs: 20 });
  process.env.BOARD_INGEST_SLOTS = "1";
  process.env.FAKE_YTDLP_DELAY_MS = "600";
  const first = fetchYoutube({ videoId: "SLOWaaaaaaa", queue: small, instanceId: "test" });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await assert.rejects(fetchYoutube({ videoId: "SLOWbbbbbbb", queue: small, instanceId: "test" }), QueueFullError);
  await first;
  delete process.env.BOARD_INGEST_SLOTS;
  delete process.env.FAKE_YTDLP_DELAY_MS;
});
