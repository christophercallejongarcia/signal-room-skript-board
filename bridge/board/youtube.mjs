import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chooseTrack, vttToText } from "../../lib/board/youtube.ts";
import { logEvent } from "../../lib/board/eventlog.mjs";
import { runSupervised, slotFree } from "../engines/supervised.mjs";

/**
 * YouTube ingest in the bridge (PLAN.md points 67, 69, 69a). Only a validated
 * 11-character video ID comes in; yt-dlp always gets the canonical watch URL
 * with --no-playlist --ignore-config --no-cache-dir, an argument array, a
 * 60 s timeout, at most 10 MB stdout and a temp folder that is removed after.
 * Every call runs under an ingest slot; at most 20 jobs wait per instance.
 */
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
export const MAX_WAITING = Number(process.env.BOARD_INGEST_MAX_WAITING || 20);
const CALL_TIMEOUT_MS = () => Number(process.env.BOARD_YTDLP_TIMEOUT_MS || 60_000);
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-ytdlp.mjs");

export class QueueFullError extends Error {
  constructor() {
    super("Warteschlange voll, gleich erneut.");
    this.status = 429;
    this.retryAfter = 5;
  }
}

export function ytdlpCommand(env = process.env) {
  if (env.BOARD_YTDLP_FAKE === "1") return { command: process.execPath, prefix: ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE] };
  const candidates = [env.BOARD_YTDLP_BIN, "/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"].filter(Boolean);
  const binary = candidates.find((file) => fs.existsSync(file)) ?? "yt-dlp";
  return { command: binary, prefix: [] };
}

export function canonicalUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function metadataArgs(videoId, tmp) {
  return ["--ignore-config", "--no-playlist", "--no-cache-dir", "--skip-download", "--dump-single-json", "-P", tmp, canonicalUrl(videoId)];
}

export function subtitleArgs(videoId, tmp, track) {
  return [
    "--ignore-config",
    "--no-playlist",
    "--no-cache-dir",
    "--skip-download",
    track.automatic ? "--write-auto-subs" : "--write-subs",
    "--sub-langs",
    track.lang,
    "--sub-format",
    "vtt",
    "-P",
    tmp,
    "-o",
    "%(id)s.%(ext)s",
    canonicalUrl(videoId),
  ];
}

export function channelArgs(channelId) {
  return ["--ignore-config", "--no-cache-dir", "--flat-playlist", "--playlist-end", "30", "--print", "%(view_count)s", `https://www.youtube.com/channel/${channelId}/videos`];
}

class YtdlpError extends Error {
  constructor(message, status = 502, code = "ytdlp") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Waiting room for ingest jobs: a job waits until an ingest slot is free; same video IDs share one job. */
export class IngestQueue {
  constructor({ maxWaiting = MAX_WAITING, pollMs = 150 } = {}) {
    this.maxWaiting = maxWaiting;
    this.pollMs = pollMs;
    this.waiting = 0;
    this.jobs = new Map();
  }

  /** Run `job` for `key`; a second request for the same key joins the running one. */
  run(key, job) {
    const existing = this.jobs.get(key);
    if (existing) return existing;
    const promise = job().finally(() => this.jobs.delete(key));
    this.jobs.set(key, promise);
    return promise;
  }

  /** Wait for a slot (bounded waiting room), then call `fn`; retries if the supervisor lost the race for the slot. */
  async withSlot(fn, signal) {
    let counted = false;
    try {
      for (;;) {
        if (signal?.aborted) throw new YtdlpError("Abgebrochen.", 499, "aborted");
        if (slotFree("ingest")) {
          const result = await fn();
          if (!result.slotBusy) return result;
        }
        if (!counted) {
          if (this.waiting >= this.maxWaiting) throw new QueueFullError();
          this.waiting += 1;
          counted = true;
        }
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      }
    } finally {
      if (counted) this.waiting -= 1;
    }
  }
}

async function ytdlp(queue, { args, instanceId, env, signal, tmp }) {
  const { command, prefix } = ytdlpCommand(env);
  const runId = `ingest-${randomBytes(6).toString("hex")}`;
  const result = await queue.withSlot(
    () => runSupervised({ runId, kind: "ingest", command, args: [...prefix, ...args], env, signal, timeoutMs: CALL_TIMEOUT_MS(), maxStdoutBytes: 10 * 1024 * 1024, instanceId, tmpDir: tmp }),
    signal,
  );
  if (result.timedOut) throw new YtdlpError("yt-dlp hat nicht rechtzeitig geantwortet.", 504, "timeout");
  if (result.overflow) throw new YtdlpError("yt-dlp hat zu viel ausgegeben.", 502, "overflow");
  if (result.aborted) throw new YtdlpError("Abgebrochen.", 499, "aborted");
  if (result.code !== 0) throw new YtdlpError(`yt-dlp ist fehlgeschlagen: ${result.stderr.trim().split("\n").pop()?.slice(0, 200) ?? "unbekannt"}`, 502, "exit");
  return result.stdout;
}

/** Metadata, transcript and optionally the channel's recent view counts for one video. */
export async function fetchYoutube({ videoId, withChannel = false, queue, instanceId, env = process.env, signal }) {
  if (!VIDEO_ID.test(videoId)) throw new YtdlpError("Ungültige Video-ID.", 400, "invalid");
  const started = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `sr-board-${instanceId}-yt-`));
  try {
    const metaText = await ytdlp(queue, { args: metadataArgs(videoId, tmp), instanceId, env, signal, tmp });
    let meta;
    try {
      meta = JSON.parse(metaText);
    } catch {
      throw new YtdlpError("yt-dlp lieferte keine gültigen Metadaten.", 502, "json");
    }
    const track = chooseTrack(meta);
    let transcript = null;
    if (track) {
      await ytdlp(queue, { args: subtitleArgs(videoId, tmp, track), instanceId, env, signal, tmp });
      const file = fs.readdirSync(tmp).find((name) => name.endsWith(".vtt"));
      const text = file ? vttToText(fs.readFileSync(path.join(tmp, file), "utf8")) : "";
      if (text) transcript = { text, source: track.source, lang: track.lang };
    }
    let channelViews;
    if (withChannel && typeof meta.channel_id === "string" && CHANNEL_ID.test(meta.channel_id)) {
      try {
        const out = await ytdlp(queue, { args: channelArgs(meta.channel_id), instanceId, env, signal, tmp });
        channelViews = out.split("\n").map((line) => Number(line.trim())).filter((value) => Number.isFinite(value) && value > 0);
      } catch {
        channelViews = undefined;
      }
    }
    logEvent({ instanceId, layer: "bridge", phase: "youtube", durationMs: Date.now() - started, status: transcript ? 200 : 204 });
    return {
      meta: {
        title: typeof meta.title === "string" ? meta.title.slice(0, 300) : undefined,
        channelTitle: typeof (meta.channel ?? meta.uploader) === "string" ? String(meta.channel ?? meta.uploader).slice(0, 200) : undefined,
        channelId: typeof meta.channel_id === "string" && CHANNEL_ID.test(meta.channel_id) ? meta.channel_id : undefined,
        views: Number.isFinite(meta.view_count) ? meta.view_count : undefined,
        uploadDate: typeof meta.upload_date === "string" ? meta.upload_date : undefined,
        durationSec: Number.isFinite(meta.duration) ? meta.duration : undefined,
        language: typeof meta.language === "string" ? meta.language : undefined,
      },
      transcript,
      noCaptions: !transcript,
      channelViews,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Bridge route `POST /v1/board/youtube`. */
export function youtubeRoute({ instance, readJson }) {
  const queue = new IngestQueue();
  return {
    queue,
    route: {
      method: "POST",
      pattern: /^\/v1\/board\/youtube$/,
      async handle({ request, send }) {
        const body = await readJson(request, 16 * 1024);
        const videoId = typeof body.videoId === "string" ? body.videoId : "";
        if (!VIDEO_ID.test(videoId)) return send(400, { error: "Ungültige Video-ID." });
        try {
          // No abort on disconnect: other requests may share this job, and every call is bounded by its own timeout.
          const result = await queue.run(`${videoId}:${body.withChannel ? 1 : 0}`, () => fetchYoutube({ videoId, withChannel: body.withChannel === true, queue, instanceId: instance.instanceId }));
          return send(200, result);
        } catch (error) {
          if (error instanceof QueueFullError) return send(429, { error: error.message }, { "retry-after": String(error.retryAfter) });
          const status = error?.status ?? 500;
          return send(status === 499 ? 499 : status, { error: status === 500 ? "YouTube-Abruf fehlgeschlagen." : error.message, code: error?.code });
        }
      },
    },
  };
}
