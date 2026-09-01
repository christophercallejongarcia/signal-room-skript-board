import { randomUUID } from "node:crypto";
import { getStorage } from "./adapters/storage/index.ts";
import type { Run, SignalRecord, TranscriptCount, TranscriptSignalPatch, RunUsage, StorageAdapter } from "./contracts.ts";
import { boundedTranscriptError, TranscriptConflictError } from "./transcripts.ts";
import { transcribeReels, type TranscriptResult, type Transcriber } from "./adapters/sources/apify-transcripts.ts";

export type TranscriptRunStorage = Pick<StorageAdapter, "listSignals" | "claimTranscript" | "patchTranscript" | "saveRun">;

export type TranscriptRunDeps = {
  storage: TranscriptRunStorage;
  transcribe: Transcriber;
  now: () => Date;
};

export type TranscriptRunResult = { signal: SignalRecord; run: Run };

/** A failed actor attempt still returns its failed Signal and its own Run to the HTTP boundary. */
export class TranscriptRunError extends Error {
  readonly signal: SignalRecord;
  readonly run: Run;

  constructor(message: string, signal: SignalRecord, run: Run) {
    super(message);
    this.name = "TranscriptRunError";
    this.signal = signal;
    this.run = run;
  }
}

/** The request names an existing Signal that cannot be sent to the Reel actor. */
export class TranscriptRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptRequestError";
  }
}

const NO_USAGE: RunUsage = { unreported: 1 };

function asError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function runId(startedAt: Date) {
  return `run-${startedAt.toISOString()}-${randomUUID().slice(0, 8)}`;
}

function countFor(result: TranscriptResult | undefined): TranscriptCount {
  if (!result) return { added: 0, silent: 0, missing: 1, failed: 0 };
  return result.transcript?.trim()
    ? { added: 1, silent: 0, missing: 0, failed: 0 }
    : { added: 0, silent: 1, missing: 0, failed: 0 };
}

function patchFor(result: TranscriptResult | undefined): TranscriptSignalPatch {
  if (!result) {
    return {
      transcript: null,
      transcriptSegments: null,
      transcriptError: null,
      transcriptStatus: "missing",
      transcriptWorkingCopy: null,
      transcriptCorrections: null,
    };
  }
  const transcript = result.transcript?.trim() ?? "";
  if (!transcript) {
    return {
      transcript: null,
      transcriptSegments: null,
      transcriptError: null,
      transcriptStatus: "silent",
      transcriptWorkingCopy: null,
      transcriptCorrections: null,
    };
  }
  return {
    transcript,
    transcriptSegments: result.segments?.length ? result.segments : null,
    transcriptError: null,
    transcriptStatus: "ready",
    transcriptWorkingCopy: null,
    transcriptCorrections: null,
  };
}

function makeRun(
  startedAt: Date,
  finishedAt: Date,
  signalId: string,
  status: Run["status"],
  transcripts: TranscriptCount,
  usage: RunUsage,
  errors: Run["errors"],
): Run {
  return {
    id: runId(startedAt),
    kind: "transcript",
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    creatorsChecked: 0,
    creatorsSkipped: 0,
    recordsAdded: 0,
    recordsUpdated: 0,
    errors,
    usage,
    transcriptSignalId: signalId,
    transcripts,
  };
}

function defaultDeps(overrides: Partial<TranscriptRunDeps>): TranscriptRunDeps {
  return {
    storage: overrides.storage ?? getStorage(),
    transcribe: overrides.transcribe ?? transcribeReels,
    now: overrides.now ?? (() => new Date()),
    ...overrides,
  };
}

/**
 * Claims exactly one Reel, waits for the shared transcript actor, patches only
 * transcript fields and logs an independent Run. The storage claim is atomic,
 * so a fresh pending Signal never reaches the actor a second time.
 */
export async function runTranscript(
  id: string,
  overrides: Partial<TranscriptRunDeps> = {},
): Promise<TranscriptRunResult | null> {
  const deps = defaultDeps(overrides);
  const existing = (await deps.storage.listSignals()).find((signal) => signal.id === id);
  if (!existing) return null;
  if (existing.format !== "reel" || !existing.url) {
    throw new TranscriptRequestError("Only Reels with a source URL can be transcribed.");
  }

  const startedAt = deps.now();
  const claimed = await deps.storage.claimTranscript(id, startedAt.toISOString());
  if (!claimed) return null;

  let actorResult: Awaited<ReturnType<Transcriber>>;
  try {
    actorResult = await deps.transcribe([claimed]);
  } catch (error) {
    const message = boundedTranscriptError(error);
    const finishedAt = deps.now();
    const failed = (await deps.storage.patchTranscript(id, {
      transcriptStatus: "failed",
      transcriptUpdatedAt: finishedAt.toISOString(),
      transcriptError: message,
    })) ?? { ...claimed, transcriptStatus: "failed" as const, transcriptUpdatedAt: finishedAt.toISOString(), transcriptError: message };
    const run = makeRun(
      startedAt,
      finishedAt,
      id,
      "failed",
      { added: 0, silent: 0, missing: 0, failed: 1 },
      NO_USAGE,
      [{ creatorId: claimed.creatorId, handle: claimed.creatorId, message }],
    );
    await deps.storage.saveRun(run);
    throw new TranscriptRunError(message, failed, run);
  }

  const result = actorResult.results.find((candidate) => candidate.id === id);
  const finishedAt = deps.now();
  const updated = await deps.storage.patchTranscript(id, {
    ...patchFor(result),
    transcriptAttempts: claimed.transcriptAttempts,
    transcriptUpdatedAt: finishedAt.toISOString(),
  });
  if (!updated) throw new Error(`Signal ${id} disappeared while its transcript was being stored.`);

  const run = makeRun(
    startedAt,
    finishedAt,
    id,
    "ok",
    countFor(result),
    actorResult.usage,
    [],
  );
  await deps.storage.saveRun(run);
  return { signal: updated, run };
}

export { TranscriptConflictError };
