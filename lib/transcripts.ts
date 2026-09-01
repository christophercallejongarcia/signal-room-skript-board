import type { Creator, SignalRecord } from "./contracts";
import { TRANSCRIPT_ERROR_MAX, TRANSCRIPT_LIMIT_PER_RUN, TRANSCRIPT_PENDING_TIMEOUT_MS, TRANSCRIPT_SCORE_THRESHOLD } from "./config.ts";
import { outlierScorer, reach } from "./adapters/scoring/outlier.ts";

/** The transcript fields used by the refresh and the manual transcript flow. */
export type TranscriptFields = Pick<SignalRecord, "transcript" | "transcriptStatus" | "transcriptUpdatedAt">;

export type TranscriptConflictReason = "pending" | "ready";

/** A second manual attempt is refused when the first one still owns the Reel. */
export class TranscriptConflictError extends Error {
  readonly reason: TranscriptConflictReason;

  constructor(reason: TranscriptConflictReason, message: string) {
    super(message);
    this.name = "TranscriptConflictError";
    this.reason = reason;
  }
}

export type TranscriptRequest = { id: string };

/** Bounds and rejects the body of POST /api/signals/transcribe. */
export function parseTranscriptRequest(body: unknown): TranscriptRequest {
  const input = (body ?? {}) as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) throw new Error("id required");
  if (id.length > 200) throw new Error("id is too long");
  return { id };
}

/** True once the reel has any assigned status, including an in-flight or failed attempt. */
export function hasTranscriptOutcome(signal: TranscriptFields) {
  return signal.transcriptStatus !== undefined;
}

/** True when a pending attempt is old enough that a manual retry may take it over. */
export function isPendingTranscriptExpired(
  signal: TranscriptFields,
  now: Date | number = new Date(),
  timeoutMs = TRANSCRIPT_PENDING_TIMEOUT_MS,
) {
  if (signal.transcriptStatus !== "pending") return false;
  const updatedAt = Date.parse(signal.transcriptUpdatedAt ?? "");
  const nowMs = typeof now === "number" ? now : now.getTime();
  // A pending row without a timestamp cannot be proven to be fresh, so it is recoverable.
  return !Number.isFinite(updatedAt) || nowMs - updatedAt > timeoutMs;
}

/** Short alias for callers that only need the pending-state predicate. */
export const isPendingExpired = isPendingTranscriptExpired;

/** Returns why a manual attempt is blocked, or null when the Reel may be claimed. */
export function transcriptConflictReason(
  signal: Pick<SignalRecord, "transcript" | "transcriptStatus" | "transcriptUpdatedAt">,
  now: Date | number = new Date(),
): TranscriptConflictReason | null {
  if (signal.transcriptStatus === "pending" && !isPendingTranscriptExpired(signal, now)) return "pending";
  if (signal.transcriptStatus === "ready" || signal.transcript?.trim()) return "ready";
  return null;
}

/** Keeps provider errors useful without allowing an actor response to grow a Signal indefinitely. */
export function boundedTranscriptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, TRANSCRIPT_ERROR_MAX) || "Transcript actor failed";
}

/** One-time repair for the old parser's false final outcomes. */
export function resetLegacyTranscriptStatuses(signals: SignalRecord[]) {
  let reset = 0;
  const cleaned = signals.map((signal) => {
    if ((signal.transcriptStatus === "silent" || signal.transcriptStatus === "missing") && !signal.transcript?.trim()) {
      const { transcriptStatus, ...withoutStatus } = signal;
      void transcriptStatus;
      reset += 1;
      return withoutStatus;
    }
    return signal;
  });
  return { signals: cleaned, reset };
}

export type TranscriptBatchOptions = { scoreThreshold?: number; limit?: number; now?: Date };

/**
 * The reels one refresh sends to the transcript actor: reels whose combined
 * Outlier-Scorer score is at or above the configured threshold, carry no outcome
 * yet, and have a URL. The same scorer calculates Outlier, Channel-Relative and
 * Velocity; strongest score first, at most limit. A reel without a URL or known
 * Creator is left alone.
 */
export function pickTranscriptBatch(signals: SignalRecord[], creators: Creator[], options: TranscriptBatchOptions = {}): SignalRecord[] {
  const threshold = options.scoreThreshold ?? TRANSCRIPT_SCORE_THRESHOLD;
  const limit = Math.max(0, Math.floor(options.limit ?? TRANSCRIPT_LIMIT_PER_RUN));
  const originalById = new Map(signals.map((signal) => [signal.id, signal]));
  return outlierScorer
    .rank(signals, creators, options.now)
    .filter((signal) => signal.format === "reel" && signal.url && !hasTranscriptOutcome(signal))
    .filter((signal) => signal.score >= threshold)
    .sort((a, b) => b.score - a.score || b.outlier - a.outlier || reach(b) - reach(a))
    .slice(0, limit)
    .map((signal) => originalById.get(signal.id)!)
    .filter((signal): signal is SignalRecord => signal !== undefined);
}
