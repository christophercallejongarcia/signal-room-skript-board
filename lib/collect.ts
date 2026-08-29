import { randomUUID } from "node:crypto";
import type { Creator, CoverCacheResult, RefreshResult, Run, RunError, RunUsage, SignalRecord } from "./contracts";
import { collectForCreator, type CollectResult } from "./adapters/sources/apify-instagram.ts";
import { getStorage, type Storage } from "./adapters/storage/index.ts";
import { cacheCovers } from "./adapters/storage/cover-cache.ts";
import { REFRESH_CREATOR_LIMIT } from "./config.ts";
import { addUsage, pickRefreshBatch } from "./run-cost.ts";

export type CollectDeps = {
  storage: Storage;
  collect: (creator: Creator) => Promise<CollectResult>;
  cacheCovers: (records: SignalRecord[]) => Promise<CoverCacheResult>;
  now: () => Date;
  /** Creators one Delta-Refresh may touch. */
  creatorLimit: number;
};

function defaultDeps(overrides: Partial<CollectDeps>): CollectDeps {
  return { storage: getStorage(), collect: collectForCreator, cacheCovers, now: () => new Date(), creatorLimit: REFRESH_CREATOR_LIMIT, ...overrides };
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

function addCounts(a: CoverCacheResult, b: CoverCacheResult): CoverCacheResult {
  return { cached: a.cached + b.cached, skipped: a.skipped + b.skipped, failed: a.failed + b.failed };
}

function newRunId(startedAt: Date) {
  return `run-${startedAt.toISOString()}-${randomUUID().slice(0, 8)}`;
}

function runStatus(checked: number, failed: number, skipped: number): Run["status"] {
  if (checked > 0 && failed >= checked) return "failed";
  return failed === 0 && skipped === 0 ? "ok" : "partial";
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

  // Second pass over the stored corpus: a cover that failed on an earlier run
  // is retried as long as its CDN link still resolves. Already cached files are skipped.
  const catchUp = await deps.cacheCovers(await deps.storage.listSignals());
  covers = { cached: covers.cached + catchUp.cached, skipped: catchUp.skipped, failed: catchUp.failed };

  const finishedAt = deps.now();
  const run: Run = {
    id: newRunId(startedAt),
    kind: "refresh",
    status: runStatus(creators.length, errors.length, skipped.length),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    creatorsChecked: creators.length,
    creatorsSkipped: skipped.length,
    recordsAdded,
    recordsUpdated,
    errors,
    usage,
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
