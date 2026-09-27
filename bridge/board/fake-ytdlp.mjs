#!/usr/bin/env node
/**
 * Fake yt-dlp for tests and the E2E fake mode (BOARD_YTDLP_FAKE=1, PLAN.md
 * points 73, 106). Behaviour depends on the video ID:
 *   NOCAPS…   no subtitles at all
 *   FAIL…     exit 1
 *   HUGE…     more than 10 MB on stdout
 *   HANG…     never answers
 *   SLOW…     waits FAKE_YTDLP_DELAY_MS (default 1500) before answering
 *   EN…       English video that also offers an auto-translated German track
 *   otherwise a German video with an automatic de-orig track
 * Every call appends its argv to FAKE_YTDLP_LOG if set.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
if (process.env.FAKE_YTDLP_LOG) {
  fs.appendFileSync(process.env.FAKE_YTDLP_LOG, `${JSON.stringify({ pid: process.pid, argv, at: Date.now() })}\n`);
  process.on("exit", () => fs.appendFileSync(process.env.FAKE_YTDLP_LOG, `${JSON.stringify({ pid: process.pid, end: Date.now() })}\n`));
}

const url = argv.at(-1) ?? "";
const valueOf = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (argv.includes("--flat-playlist")) {
    for (let i = 0; i < 30; i += 1) process.stdout.write(`${10_000 + i * 2_000}\n`);
    return;
  }
  const id = new URL(url).searchParams.get("v") ?? "";
  if (id.startsWith("SLOW")) await sleep(Number(process.env.FAKE_YTDLP_DELAY_MS || 1_500));
  if (id.startsWith("HANG")) await sleep(10 * 60_000);
  if (id.startsWith("FAIL")) {
    process.stderr.write("ERROR: [youtube] Video unavailable\n");
    process.exit(1);
  }
  if (id.startsWith("HUGE")) {
    const block = "x".repeat(1024 * 1024);
    for (let i = 0; i < 12; i += 1) process.stdout.write(block);
    return;
  }
  const english = id.startsWith("EN");
  if (argv.includes("--dump-single-json")) {
    const meta = {
      id,
      title: english ? `Fake English video ${id}` : `Fake-Video ${id}: Claude als Chef`,
      channel: "Fake-Kanal",
      channel_id: "UCabcdefghijklmnopqrstuv",
      view_count: 392_600,
      upload_date: "20260506",
      duration: 1_476,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      language: english ? "en-US" : "de-DE",
      subtitles: {},
      automatic_captions: id.startsWith("NOCAPS") ? {} : english ? { en: [], "en-orig": [], de: [] } : { "de-orig": [], de: [], en: [] },
    };
    process.stdout.write(JSON.stringify(meta));
    return;
  }
  if (argv.includes("--write-auto-subs") || argv.includes("--write-subs")) {
    const dir = valueOf("-P") ?? ".";
    const lang = valueOf("--sub-langs") ?? "de-orig";
    const lines = english
      ? ["WEBVTT", "", "00:00:00.000 --> 00:00:02.000", "Welcome to the<00:00:00.500><c> fake</c> video.", "", "00:00:02.000 --> 00:00:04.000", "Welcome to the fake video.", "It has two lines."]
      : [
          "WEBVTT",
          "Kind: captions",
          "Language: de",
          "",
          "00:00:00.080 --> 00:00:01.870 align:start position:0%",
          "Das<00:00:00.240><c> reine</c><00:00:00.560><c> Bedienen</c> von Software stirbt",
          "",
          "00:00:01.870 --> 00:00:01.880 align:start position:0%",
          "Das reine Bedienen von Software stirbt",
          "",
          "00:00:01.880 --> 00:00:03.510 align:start position:0%",
          "Das reine Bedienen von Software stirbt",
          "gerade aus und in 5 Jahren zählt etwas anderes.",
        ];
    fs.writeFileSync(path.join(dir, `${id}.${lang}.vtt`), `${lines.join("\n")}\n`);
  }
}

main();
