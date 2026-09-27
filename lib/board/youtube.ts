import { utf8Bytes } from "./limits.ts";

/**
 * YouTube ingest logic without I/O (PLAN.md points 69, 70; spike 04).
 */

export type YtMeta = {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  channel_id?: string;
  view_count?: number;
  upload_date?: string;
  duration?: number;
  thumbnail?: string;
  language?: string | null;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
};

export type TrackChoice = { lang: string; automatic: boolean; source: string } | null;

const isLang = (code: string, base: "de" | "en") => code === base || code.startsWith(`${base}-`);

/**
 * Track rule from spike 04: manual German, manual English, then the automatic
 * track in the video's original language (only German or English). Auto
 * translations (an automatic "de" on an English video) are never taken.
 */
export function chooseTrack(meta: YtMeta): TrackChoice {
  const manual = Object.keys(meta.subtitles ?? {}).filter((code) => code !== "live_chat");
  for (const base of ["de", "en"] as const) {
    const code = manual.find((candidate) => candidate === base) ?? manual.find((candidate) => isLang(candidate, base));
    if (code) return { lang: code, automatic: false, source: `manuell-${base}` };
  }
  const auto = Object.keys(meta.automatic_captions ?? {});
  const orig = auto.find((code) => code.endsWith("-orig"));
  const original = orig ?? (meta.language ? auto.find((code) => code === meta.language || code === meta.language?.split("-")[0]) : undefined);
  if (!original) return null;
  const base = original.replace(/-orig$/, "").split("-")[0];
  if (base !== "de" && base !== "en") return null;
  return { lang: original, automatic: true, source: `auto-${base}` };
}

/** WebVTT to running text: no header, no timestamps, no inline tags, no repeated lines between cues. */
export function vttToText(vtt: string): string {
  const out: string[] = [];
  let last = "";
  for (const raw of vtt.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line || line === "WEBVTT" || /^(Kind|Language|NOTE|STYLE|REGION)\b/.test(line) || /-->/.test(line) || /^\d+$/.test(line)) continue;
    const text = line
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
      .replace(/<\/?[a-z][^>]*>/gi, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text === last) continue;
    out.push(text);
    last = text;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Channel factor = views / channel median, one decimal. */
export function outlierFactor(views: number | undefined, channelMedian: number | null | undefined): number | undefined {
  if (!views || !channelMedian || channelMedian <= 0) return undefined;
  return Math.round((views / channelMedian) * 10) / 10;
}

/** Split text into chunks of at most `maxBytes` UTF-8 bytes on code point boundaries. */
export function chunkText(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of text) {
    const size = utf8Bytes(char);
    if (bytes + size > maxBytes) {
      chunks.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function publishedAtFromUploadDate(uploadDate: string | undefined): string | undefined {
  return uploadDate && /^\d{8}$/.test(uploadDate) ? `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}` : undefined;
}

export function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
