import type { RunUsage, SignalRecord, TranscriptSegment } from "../../contracts";
import { sumUsage } from "../../run-cost.ts";
import { runActor, type ActorResult } from "./apify-client.ts";

/** The transcript actor. Pay-per-event: a start fee, one fee per result, one per audio minute. */
export const TRANSCRIPT_ACTOR = "apple_yang~instagram-transcripts-scraper";

/** One reel's outcome: the text, or null when the reel has no usable audio track. */
export type TranscriptResult = { id: string; transcript: string | null; segments?: TranscriptSegment[] };

/** What one transcript pass returns to the refresh. */
export type TranscribeResult = { results: TranscriptResult[]; usage: RunUsage };

export type Transcriber = (reels: SignalRecord[]) => Promise<TranscribeResult>;

const SHORTCODE_IN_URL = /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Reads the shortcode from the actor's current response shape. */
function currentShortCodeOf(item: Record<string, unknown>) {
  const code = text(item.code);
  if (code) return code;
  return text(item.url).match(SHORTCODE_IN_URL)?.[1];
}

/**
 * Reads the shortcode of one dataset item. The current fields are preferred;
 * the tolerant field search remains a fallback for older actor responses.
 */
function shortCodeOf(item: Record<string, unknown>) {
  const current = currentShortCodeOf(item);
  if (current) return current;
  for (const value of Object.values(item)) {
    const match = typeof value === "string" ? value.match(SHORTCODE_IN_URL) : null;
    if (match) return match[1];
  }
  return text(item.shortCode) || text(item.shortcode) || undefined;
}

function joinedSegments(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((segment) => (segment && typeof segment === "object" ? text((segment as { text?: unknown }).text) : ""))
        .filter(Boolean)
        .join(" ")
        .trim()
    : "";
}

/** Keeps only segments with the timestamps needed by the Reel view. */
function timedSegments(value: unknown): TranscriptSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const segments = value.flatMap((segment) => {
    if (!segment || typeof segment !== "object") return [];
    const raw = segment as { start?: unknown; end?: unknown; text?: unknown };
    const start = typeof raw.start === "number" && Number.isFinite(raw.start) ? raw.start : undefined;
    const end = typeof raw.end === "number" && Number.isFinite(raw.end) ? raw.end : undefined;
    const segmentText = text(raw.text);
    return start !== undefined && end !== undefined && segmentText ? [{ start, end, text: segmentText }] : [];
  });
  return segments.length ? segments : undefined;
}

/** The transcript text of one dataset item in the actor's current response shape. */
function transcriptOf(item: Record<string, unknown>) {
  const current = text(item.text);
  if (current) return current;
  const segments = joinedSegments(item.segments);
  if (segments) return segments;
  // Fallback for older or undocumented actor response variants.
  return text(item.transcript) || text(item.transcription) || joinedSegments(item.transcriptSegments);
}

/**
 * Maps the actor's dataset back onto the reels it was asked for, by shortcode.
 * An item with no text marks its reel silent (null). A reel the dataset does
 * not mention is left out, so the next run asks again rather than marking a
 * transient miss as final.
 */
export function readTranscriptItems(items: unknown[], reels: Pick<SignalRecord, "id" | "externalId">[]): TranscriptResult[] {
  const byCode = new Map(reels.flatMap((reel) => (reel.externalId ? [[reel.externalId, reel.id] as const] : [])));
  const results: TranscriptResult[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const code = shortCodeOf(item);
    const id = code ? byCode.get(code) : undefined;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const transcript = transcriptOf(item);
    const segments = timedSegments(item.segments) ?? timedSegments(item.transcriptSegments);
    results.push({ id, transcript: transcript || null, ...(segments ? { segments } : {}) });
  }
  return results;
}

/** Sends the reels' urls to the transcript actor in one run and reads the outcome and the usage. */
export async function transcribeReels(reels: SignalRecord[], run: typeof runActor = runActor): Promise<TranscribeResult> {
  const urls = reels.flatMap((reel) => (reel.url ? [reel.url] : []));
  if (urls.length === 0) return { results: [], usage: { unreported: 0 } };
  const { items, usage }: ActorResult<unknown> = await run(TRANSCRIPT_ACTOR, { bulkUrls: urls });
  return { results: readTranscriptItems(items, reels), usage: sumUsage([usage]) };
}
