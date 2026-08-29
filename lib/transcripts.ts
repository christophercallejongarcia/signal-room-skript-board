import type { Creator, SignalRecord } from "./contracts";
import { OUTLIER_THRESHOLD, TRANSCRIPT_LIMIT_PER_RUN } from "./config.ts";
import { reach } from "./adapters/scoring/outlier.ts";

/** The one field pair the whole app reads a transcript from. */
export type TranscriptFields = Pick<SignalRecord, "transcript" | "transcriptStatus">;

/** True once the reel was handled: transcript stored, or marked silent. Both are final. */
export function hasTranscriptOutcome(signal: TranscriptFields) {
  return Boolean(signal.transcript?.trim()) || signal.transcriptStatus !== undefined;
}

export type TranscriptBatchOptions = { threshold?: number; limit?: number };

/**
 * The reels one refresh sends to the transcript actor: reels at or above the
 * outlier threshold (plays over audience, same factor as everywhere else) that
 * carry no outcome yet, strongest first, at most limit. A reel without a url
 * cannot be fetched and is left alone.
 */
export function pickTranscriptBatch(signals: SignalRecord[], creators: Creator[], options: TranscriptBatchOptions = {}): SignalRecord[] {
  const threshold = options.threshold ?? OUTLIER_THRESHOLD;
  const limit = Math.max(1, Math.floor(options.limit ?? TRANSCRIPT_LIMIT_PER_RUN));
  const audience = new Map(creators.map((creator) => [creator.id, creator.audience]));
  const outlierOf = (signal: SignalRecord) => {
    const followers = audience.get(signal.creatorId) ?? 0;
    return followers > 0 ? reach(signal) / followers : 0;
  };
  return signals
    .filter((signal) => signal.format === "reel" && signal.url && !hasTranscriptOutcome(signal))
    .filter((signal) => outlierOf(signal) >= threshold)
    .sort((a, b) => outlierOf(b) - outlierOf(a))
    .slice(0, limit);
}
