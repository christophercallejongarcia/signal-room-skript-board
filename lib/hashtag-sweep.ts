import { randomUUID } from "node:crypto";
import { getStorage, type Storage } from "./adapters/storage/index.ts";
import { collectHashtagPosts, configuredInstagramHashtags, type HashtagCollectResult } from "./adapters/sources/apify-instagram-hashtags.ts";
import { INSTAGRAM_HASHTAG_COST_LIMIT_USD } from "./config.ts";
import type { HashtagPost, Run, RunUsage } from "./contracts";

export type HashtagSweepStorage = Pick<Storage, "saveHashtagPosts" | "saveRun">;

export type HashtagSweepDeps = {
  storage: HashtagSweepStorage;
  collect: () => Promise<HashtagCollectResult>;
  now: () => Date;
  hashtags: string[];
  costLimitUsd: number;
};

export type HashtagSweepResult = {
  postsAdded: number;
  postsUpdated: number;
  completedAt: string;
  runId: string;
  usage: RunUsage;
};

export class HashtagSweepCostError extends Error {
  readonly usage: RunUsage;

  constructor(message: string, usage: RunUsage) {
    super(message);
    this.name = "HashtagSweepCostError";
    this.usage = usage;
  }
}

function idFor(startedAt: Date) {
  return `run-${startedAt.toISOString()}-${randomUUID().slice(0, 8)}`;
}

function verifiedCost(usage: RunUsage, limit: number) {
  if (usage.costUsd === undefined && usage.unreported > 0) {
    throw new HashtagSweepCostError("Apify did not report a verifiable cost for the hashtag sweep", usage);
  }
  if (usage.costUsd !== undefined && usage.costUsd > limit) {
    throw new HashtagSweepCostError(`hashtag sweep cost $${usage.costUsd.toFixed(3)} exceeds the $${limit.toFixed(3)} limit`, usage);
  }
}

function asError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function defaultDeps(overrides: Partial<HashtagSweepDeps>): HashtagSweepDeps {
  const hashtags = overrides.hashtags ?? configuredInstagramHashtags();
  return {
    storage: overrides.storage ?? getStorage(),
    collect: overrides.collect ?? (() => collectHashtagPosts(hashtags)),
    now: overrides.now ?? (() => new Date()),
    hashtags,
    costLimitUsd: overrides.costLimitUsd ?? INSTAGRAM_HASHTAG_COST_LIMIT_USD,
    ...overrides,
  };
}

/**
 * Runs the daily Instagram-only hashtag pass and records it as its own Run.
 * Records are committed only after the reported cost passes the guard.
 */
export async function runHashtagSweep(overrides: Partial<HashtagSweepDeps> = {}): Promise<HashtagSweepResult> {
  const deps = defaultDeps(overrides);
  const startedAt = deps.now();
  let usage: RunUsage = { unreported: 1 };
  let saved = { inserted: 0, updated: 0 };
  let failure: unknown;

  try {
    const result = await deps.collect();
    usage = result.usage;
    verifiedCost(usage, deps.costLimitUsd);
    saved = await deps.storage.saveHashtagPosts(result.posts);
  } catch (error) {
    failure = error;
    if (error instanceof HashtagSweepCostError) usage = error.usage;
  }

  const finishedAt = deps.now();
  const run: Run = {
    id: idFor(startedAt),
    kind: "hashtag-sweep",
    status: failure ? "failed" : "ok",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    creatorsChecked: 0,
    creatorsSkipped: 0,
    recordsAdded: saved.inserted,
    recordsUpdated: saved.updated,
    errors: failure
      ? [{ creatorId: "hashtags", handle: deps.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(", "), message: asError(failure) }]
      : [],
    usage,
    hashtagsChecked: deps.hashtags.length,
    costLimitUsd: deps.costLimitUsd,
  };
  await deps.storage.saveRun(run);
  if (failure) throw failure;

  return {
    postsAdded: saved.inserted,
    postsUpdated: saved.updated,
    completedAt: run.finishedAt,
    runId: run.id,
    usage,
  };
}

