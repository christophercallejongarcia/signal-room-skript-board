import { randomUUID } from "node:crypto";
import type { Creator, CoverCacheResult, RefreshResult, Run, RunError, SignalRecord } from "./contracts";
import { collectForCreator } from "./adapters/sources/apify-instagram.ts";
import { getStorage, type Storage } from "./adapters/storage/index.ts";
import { cacheCovers } from "./adapters/storage/cover-cache.ts";

export type CollectDeps = {
  storage: Storage;
  collect: (creator: Creator) => Promise<SignalRecord[]>;
  cacheCovers: (records: SignalRecord[]) => Promise<CoverCacheResult>;
  now: () => Date;
};

function defaultDeps(overrides: Partial<CollectDeps>): CollectDeps {
  return { storage: getStorage(), collect: collectForCreator, cacheCovers, now: () => new Date(), ...overrides };
}

export type CollectStep = { recordsAdded: number; recordsUpdated: number; covers: CoverCacheResult };

/**
 * One collection step for a creator: pull signals (backfill or delta-refresh
 * depending on lastCheckedAt), store them, advance the cursor, cache covers.
 * Idempotent per record and per cover. The cursor moves only after both
 * streams succeeded and the records are stored; an actor error propagates.
 */
export async function collectAndStore(creator: Creator, overrides: Partial<CollectDeps> = {}): Promise<CollectStep> {
  const deps = defaultDeps(overrides);
  const startedAt = deps.now();
  const records = await deps.collect(creator);
  const saved = await deps.storage.saveSignals(records);
  await deps.storage.upsertCreator({ ...creator, lastCheckedAt: startedAt.toISOString() });
  const covers = await deps.cacheCovers(records);
  return { recordsAdded: saved.inserted, recordsUpdated: saved.updated, covers };
}

function addCounts(a: CoverCacheResult, b: CoverCacheResult): CoverCacheResult {
  return { cached: a.cached + b.cached, skipped: a.skipped + b.skipped, failed: a.failed + b.failed };
}

function newRunId(startedAt: Date) {
  return `run-${startedAt.toISOString()}-${randomUUID().slice(0, 8)}`;
}

function runStatus(checked: number, failed: number): Run["status"] {
  if (failed === 0) return "ok";
  return failed >= checked ? "failed" : "partial";
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
  });
  if (!step) throw failure;
  return step;
}

/**
 * Delta-refresh over every Instagram creator. A failing creator is recorded
 * in the run and skipped; the others continue. The run is persisted even when
 * every creator failed, so the Profile tab shows what happened.
 */
export async function runRefresh(overrides: Partial<CollectDeps> = {}): Promise<RefreshResult> {
  const deps = defaultDeps(overrides);
  const startedAt = deps.now();
  const creators = (await deps.storage.listCreators()).filter((c) => c.network === "instagram");
  let recordsAdded = 0;
  let recordsUpdated = 0;
  let covers: CoverCacheResult = { cached: 0, skipped: 0, failed: 0 };
  const errors: RunError[] = [];

  for (const creator of creators) {
    try {
      const step = await collectAndStore(creator, deps);
      recordsAdded += step.recordsAdded;
      recordsUpdated += step.recordsUpdated;
      covers = addCounts(covers, step.covers);
    } catch (error) {
      errors.push({ creatorId: creator.id, handle: creator.handle, message: error instanceof Error ? error.message : String(error) });
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
    status: runStatus(creators.length, errors.length),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    creatorsChecked: creators.length,
    recordsAdded,
    recordsUpdated,
    errors,
  };
  await deps.storage.saveRun(run);

  return {
    creatorsChecked: creators.length,
    recordsAdded,
    recordsUpdated,
    completedAt: run.finishedAt,
    covers,
    errors: errors.map((e) => `${e.handle}: ${e.message}`),
    runId: run.id,
  };
}
