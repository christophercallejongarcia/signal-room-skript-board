import { randomUUID } from "node:crypto";
import type { Creator, CoverCacheResult, RefreshResult, Run, RunError, RunUsage, SignalRecord, TranscriptCount } from "./contracts";
import { collectForCreator, type CollectResult } from "./adapters/sources/apify-instagram.ts";
import { transcribeReels, type Transcriber } from "./adapters/sources/apify-transcripts.ts";
import { getStorage, type Storage } from "./adapters/storage/index.ts";
import { cacheCovers } from "./adapters/storage/cover-cache.ts";
import { REFRESH_CREATOR_LIMIT, TRANSCRIPT_LIMIT_PER_RUN } from "./config.ts";
import { addUsage, pickRefreshBatch } from "./run-cost.ts";
import { boundedTranscriptError, pickTranscriptBatch } from "./transcripts.ts";

/** The slice of Storage a collection pass touches; the cron hands in one built over a Convex action context. */
export type CollectStorage = Pick<Storage, "listCreators" | "upsertCreator" | "listSignals" | "saveSignals" | "saveRun">;

export type CollectDeps = {
  storage: CollectStorage;
  collect: (creator: Creator) => Promise<CollectResult>;
  cacheCovers: (records: SignalRecord[]) => Promise<CoverCacheResult>;
  now: () => Date;
  /** Creators one Delta-Refresh may touch. */
  creatorLimit: number;
  /** Fetches what is said in the given reels. */
  transcribe: Transcriber;
  /** Reels one Delta-Refresh may send to the transcript actor. */
  transcriptLimit: number;
};

function defaultDeps(overrides: Partial<CollectDeps>): CollectDeps {
  // Storage is resolved lazily: a caller that brings its own (the Convex cron) never opens the server's.
  return {
    storage: overrides.storage ?? getStorage(),
    collect: collectForCreator,
    cacheCovers,
    now: () => new Date(),
    creatorLimit: REFRESH_CREATOR_LIMIT,
    transcribe: transcribeReels,
    transcriptLimit: TRANSCRIPT_LIMIT_PER_RUN,
    ...overrides,
  };
}

export type CollectStep = { recordsAdded: number; recordsUpdated: number; covers: CoverCacheResult; usage: RunUsage };

const NO_USAGE: RunUsage = { unreported: 0 };

/**
 * One collection step for a creator: pull signals (backfill or delta-refresh
 * depending on lastCheckedAt), store them, advance the cursor, cache covers.
 * Idempotent per record and per cover. The cursor moves only after both
 * streams succeeded and the records are stored; an actor error propagates.
 */
export async function collectAndStore(creator: Creator, overrides: Partial<CollectDeps> = {}): Promise<CollectStep> {
  const deps = defaultDeps(overrides);
  const startedAt = deps.now();
  const { records, usage } = await deps.collect(creator);
  const saved = await deps.storage.saveSignals(records);
  await deps.storage.upsertCreator({ ...creator, lastCheckedAt: startedAt.toISOString() });
  const covers = await deps.cacheCovers(records);
  return { recordsAdded: saved.inserted, recordsUpdated: saved.updated, covers, usage };
}

/**
 * The transcript pass of a refresh: the outlier reels without an outcome yet go
 * to the transcript actor once, at most transcriptLimit of them. They are marked
 * pending before the actor is called. A reel with text stores it as ready, one
 * the actor answered without text is silent, one the actor left out while
 * answering others is missing. An actor failure marks every sent reel failed,
 * records the bounded cause and counts those failures on the run. The actor's
 * usage counts into the same run as the collection.
 */
async function transcribeOutliers(deps: CollectDeps, creators: Creator[]): Promise<{ count: TranscriptCount; usage: RunUsage }> {
  const count: TranscriptCount = { added: 0, silent: 0, missing: 0, failed: 0 };
  if (deps.transcriptLimit <= 0) return { count, usage: NO_USAGE };
  const batch = pickTranscriptBatch(await deps.storage.listSignals(), creators, { limit: deps.transcriptLimit, now: deps.now() });
  if (batch.length === 0) return { count, usage: NO_USAGE };

  const pendingAt = deps.now().toISOString();
  const pending = batch.map((reel) => {
    const { savedAt, ...stored } = reel;
    void savedAt;
    return {
      ...stored,
      transcriptStatus: "pending" as const,
      transcriptAttempts: Math.max(0, Math.floor(reel.transcriptAttempts ?? 0)) + 1,
      transcriptUpdatedAt: pendingAt,
    };
  });
  const attempts = new Map(pending.map((reel) => [reel.id, reel.transcriptAttempts]));
  await deps.storage.saveSignals(pending);

  let results: Awaited<ReturnType<Transcriber>>["results"] = [];
  let usage: RunUsage = NO_USAGE;
  try {
    ({ results, usage } = await deps.transcribe(batch));
  } catch (error) {
    await failTranscriptBatch(deps, batch, error, { unreported: 1 });
  }
  const answered = new Map(results.map((result) => [result.id, result.transcript]));
  if (![...answered.keys()].some((id) => batch.some((reel) => reel.id === id))) {
    await failTranscriptBatch(
      deps,
      batch,
      new Error(`transcript actor answered ${results.length} item(s), none for the ${batch.length} reel(s) sent`),
      usage,
    );
  }
  const patched: SignalRecord[] = [];
  for (const reel of batch) {
    // savedAt is Chris' mark: never part of what a refresh writes back.
    const { savedAt, ...stored } = reel;
    void savedAt;
    if (!answered.has(reel.id)) {
      patched.push({
        ...stored,
        transcriptStatus: "missing",
        transcriptAttempts: attempts.get(reel.id),
        transcriptUpdatedAt: deps.now().toISOString(),
      });
      count.missing += 1;
    } else if (answered.get(reel.id)) {
      const result = results.find((candidate) => candidate.id === reel.id);
      patched.push({
        ...stored,
        transcript: answered.get(reel.id)!,
        transcriptStatus: "ready",
        transcriptAttempts: attempts.get(reel.id),
        transcriptUpdatedAt: deps.now().toISOString(),
        ...(result?.segments?.length ? { transcriptSegments: result.segments } : {}),
      });
      count.added += 1;
    } else {
      patched.push({
        ...stored,
        transcriptStatus: "silent",
        transcriptAttempts: attempts.get(reel.id),
        transcriptUpdatedAt: deps.now().toISOString(),
      });
      count.silent += 1;
    }
  }
  await deps.storage.saveSignals(patched);
  return { count, usage };
}

/** An actor failure after the batch was marked pending. */
class TranscriptPassError extends Error {
  readonly failed: number;
  readonly usage: RunUsage;

  constructor(message: string, failed: number, usage: RunUsage) {
    super(message);
    this.failed = failed;
    this.usage = usage;
  }
}

async function failTranscriptBatch(deps: CollectDeps, batch: SignalRecord[], error: unknown, usage: RunUsage): Promise<never> {
  const message = boundedTranscriptError(error);
  const updatedAt = deps.now().toISOString();
  const failed = batch.map((reel) => {
    const { savedAt, ...stored } = reel;
    void savedAt;
    return {
      ...stored,
      transcriptStatus: "failed" as const,
      transcriptAttempts: Math.max(0, Math.floor(reel.transcriptAttempts ?? 0)) + 1,
      transcriptUpdatedAt: updatedAt,
      transcriptError: message,
    };
  });
  await deps.storage.saveSignals(failed);
  throw new TranscriptPassError(message, batch.length, usage);
}

function addCounts(a: CoverCacheResult, b: CoverCacheResult): CoverCacheResult {
  return { cached: a.cached + b.cached, skipped: a.skipped + b.skipped, failed: a.failed + b.failed };
}

function newRunId(startedAt: Date) {
  return `run-${startedAt.toISOString()}-${randomUUID().slice(0, 8)}`;
}

function runStatus(checked: number, failed: number, skipped: number, transcriptsFailed = false): Run["status"] {
  if (checked > 0 && failed >= checked) return "failed";
  return failed === 0 && skipped === 0 && !transcriptsFailed ? "ok" : "partial";
}

/**
 * First import for a newly added creator, logged as a backfill run. The error
 * is rethrown after the run is written so the caller can answer 502.
 */
export async function runBackfill(creator: Creator, overrides: Partial<CollectDeps> = {}): Promise<CollectStep> {
  const deps = defaultDeps(overrides);
  const startedAt = deps.now();
  let step: CollectStep | undefined;
  let failure: unknown;
  try {
    step = await collectAndStore(creator, deps);
  } catch (error) {
    failure = error;
  }
  const finishedAt = deps.now();
  const message = failure instanceof Error ? failure.message : String(failure);
  await deps.storage.saveRun({
    id: newRunId(startedAt),
    kind: "backfill",
    status: step ? "ok" : "failed",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    creatorsChecked: 1,
    recordsAdded: step?.recordsAdded ?? 0,
    recordsUpdated: step?.recordsUpdated ?? 0,
    errors: step ? [] : [{ creatorId: creator.id, handle: creator.handle, message }],
    // A failed backfill ran the actors too, but their usage never came back: unknown, not free.
    usage: step?.usage ?? { unreported: 2 },
  });
  if (!step) throw failure;
  return step;
}

/**
 * Delta-refresh over the Instagram creators, at most creatorLimit of them per
 * run (never-checked and stalest cursor first). A failing creator is recorded
 * in the run and skipped; the others continue. Creators past the limit keep
 * their lastCheckedAt and the run ends partial, so the next run picks them up
 * first. The run is persisted even when every creator failed, so the Profile
 * tab shows what happened and what it cost.
 */
export async function runRefresh(overrides: Partial<CollectDeps> = {}): Promise<RefreshResult> {
  const deps = defaultDeps(overrides);
  const startedAt = deps.now();
  const instagram = (await deps.storage.listCreators()).filter((c) => c.network === "instagram");
  const { batch: creators, skipped } = pickRefreshBatch(instagram, deps.creatorLimit);
  let recordsAdded = 0;
  let recordsUpdated = 0;
  let covers: CoverCacheResult = { cached: 0, skipped: 0, failed: 0 };
  let usage = NO_USAGE;
  const errors: RunError[] = [];

  for (const creator of creators) {
    try {
      const step = await collectAndStore(creator, deps);
      recordsAdded += step.recordsAdded;
      recordsUpdated += step.recordsUpdated;
      covers = addCounts(covers, step.covers);
      usage = addUsage(usage, step.usage);
    } catch (error) {
      errors.push({ creatorId: creator.id, handle: creator.handle, message: error instanceof Error ? error.message : String(error) });
      // The failing creator's actors ran (one stream may have finished) but their usage is lost with the error.
      usage = addUsage(usage, { unreported: 2 });
    }
  }

  // Transcripts ride on the same run and the same budget as the collection. A
  // failing actor is one logged error, never a lost refresh.
  let transcripts: TranscriptCount = { added: 0, silent: 0, missing: 0, failed: 0 };
  let transcriptsFailed = false;
  try {
    const pass = await transcribeOutliers(deps, instagram);
    transcripts = pass.count;
    usage = addUsage(usage, pass.usage);
  } catch (error) {
    transcriptsFailed = true;
    if (error instanceof TranscriptPassError) transcripts.failed += error.failed;
    errors.push({ creatorId: "transcripts", handle: "transcripts", message: error instanceof Error ? error.message : String(error) });
    // A mismatch still ran and was paid; any other failure lost its figure with the error.
    usage = addUsage(usage, error instanceof TranscriptPassError ? error.usage : { unreported: 1 });
  }

  // Second pass over the stored corpus: a cover that failed on an earlier run
  // is retried as long as its CDN link still resolves. Already cached files are skipped.
  const catchUp = await deps.cacheCovers(await deps.storage.listSignals());
  covers = { cached: covers.cached + catchUp.cached, skipped: catchUp.skipped, failed: catchUp.failed };

  const finishedAt = deps.now();
  const run: Run = {
    id: newRunId(startedAt),
    kind: "refresh",
    status: runStatus(creators.length, errors.length - (transcriptsFailed ? 1 : 0), skipped.length, transcriptsFailed),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    creatorsChecked: creators.length,
    creatorsSkipped: skipped.length,
    recordsAdded,
    recordsUpdated,
    errors,
    usage,
    transcripts,
  };
  await deps.storage.saveRun(run);

  return {
    creatorsChecked: creators.length,
    creatorsSkipped: skipped.length,
    recordsAdded,
    recordsUpdated,
    completedAt: run.finishedAt,
    covers,
    errors: errors.map((e) => `${e.handle}: ${e.message}`),
    runId: run.id,
  };
}
