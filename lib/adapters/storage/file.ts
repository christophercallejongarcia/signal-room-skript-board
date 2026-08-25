import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Creator, Idea, Run, SignalRecord, StorageAdapter } from "../../contracts";
import { applyStoryboard, claimDevelop, releaseDevelop } from "../../ideas.ts";
import { mergeSignals } from "../../refresh-window.ts";

type Store = { creators: Creator[]; signals: SignalRecord[]; runs: Run[]; ideas: Idea[] };

const STORE_PATH = path.join(process.cwd(), "data", "store.json");
/** Runs kept in the file store; Convex keeps everything. */
const MAX_RUNS = 100;
/** Ideas kept in the file store; Convex keeps everything. */
const MAX_IDEAS = 500;
const EMPTY: Store = { creators: [], signals: [], runs: [], ideas: [] };

async function load(): Promise<Store> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      creators: parsed.creators ?? [],
      signals: parsed.signals ?? [],
      runs: parsed.runs ?? [],
      ideas: parsed.ideas ?? [],
    };
  } catch {
    return { ...EMPTY };
  }
}

async function save(store: Store) {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, STORE_PATH);
}

/**
 * Serializes writes inside one process only. Two Next.js workers on the same
 * data/store.json still race, so the develop-run claim is only as strong as the
 * single-process dev setup this store is meant for (ADR-0005). Convex is the
 * real store, and there the claim is transactional.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export const fileStorage: StorageAdapter & { upsertCreator(creator: Creator): Promise<void> } = {
  async listCreators() {
    return (await load()).creators;
  },
  async addCreator(creator) {
    return this.upsertCreator(creator);
  },
  async upsertCreator(creator) {
    await serialized(async () => {
      const store = await load();
      const index = store.creators.findIndex((c) => c.id === creator.id);
      if (index >= 0) store.creators[index] = { ...store.creators[index], ...creator };
      else store.creators.push(creator);
      await save(store);
    });
  },
  async listSignals() {
    return (await load()).signals;
  },
  async saveSignals(records) {
    return serialized(async () => {
      const store = await load();
      const { signals, inserted, updated } = mergeSignals(store.signals, records);
      store.signals = signals;
      await save(store);
      return { inserted, updated };
    });
  },
  async saveRun(run) {
    await serialized(async () => {
      const store = await load();
      store.runs = [run, ...store.runs.filter((r) => r.id !== run.id)].slice(0, MAX_RUNS);
      await save(store);
    });
  },
  async listRuns(limit = 10) {
    const runs = (await load()).runs;
    return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  },
  async listIdeas(limit = 50) {
    const ideas = (await load()).ideas;
    return [...ideas].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  },
  async saveIdea(idea) {
    await serialized(async () => {
      const store = await load();
      store.ideas = [idea, ...store.ideas.filter((existing) => existing.id !== idea.id)].slice(0, MAX_IDEAS);
      await save(store);
    });
  },
  async claimIdeaDevelop(id, runId, now) {
    return serialized(async () => {
      const store = await load();
      const index = store.ideas.findIndex((idea) => idea.id === id);
      if (index < 0) return null;
      const claimed = claimDevelop(store.ideas[index], runId, now);
      store.ideas[index] = claimed;
      await save(store);
      return claimed;
    });
  },
  async settleIdeaDevelop(id, runId, result) {
    return serialized(async () => {
      const store = await load();
      const index = store.ideas.findIndex((idea) => idea.id === id);
      if (index < 0) return null;
      const settled = result.storyboard
        ? applyStoryboard(store.ideas[index], runId, result.storyboard, {
            now: result.now,
            evidenceCount: result.evidenceCount,
          })
        : releaseDevelop(store.ideas[index], runId, result.now);
      // A newer run holds the claim: this result is stale and is dropped.
      if (!settled) return null;
      store.ideas[index] = settled;
      await save(store);
      return settled;
    });
  },
};
