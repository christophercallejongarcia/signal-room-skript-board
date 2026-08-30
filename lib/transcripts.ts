import type { Creator, SignalRecord } from "./contracts";
import { OUTLIER_THRESHOLD, TRANSCRIPT_LIMIT_PER_RUN } from "./config.ts";
import { outlierFactor } from "./adapters/scoring/outlier.ts";

/** The one field pair the whole app reads a transcript from. */
export type TranscriptFields = Pick<SignalRecord, "transcript" | "transcriptStatus">;

/** True once the reel has a final status: ready, silent or missing. */
export function hasTranscriptOutcome(signal: TranscriptFields) {
  return signal.transcriptStatus !== undefined;
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
  const outlierOf = (signal: SignalRecord) => outlierFactor(signal, audience.get(signal.creatorId) ?? 0);
  return signals
    .filter((signal) => signal.format === "reel" && signal.url && !hasTranscriptOutcome(signal))
    .filter((signal) => outlierOf(signal) >= threshold)
    .sort((a, b) => outlierOf(b) - outlierOf(a))
    .slice(0, limit);
}
