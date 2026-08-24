import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Creator, Run, SignalRecord, StorageAdapter } from "../../contracts";
import { mergeSignals } from "../../refresh-window.ts";

type Store = { creators: Creator[]; signals: SignalRecord[]; runs: Run[] };

const STORE_PATH = path.join(process.cwd(), "data", "store.json");
/** Runs kept in the file store; Convex keeps everything. */
const MAX_RUNS = 100;
const EMPTY: Store = { creators: [], signals: [], runs: [] };

async function load(): Promise<Store> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { creators: parsed.creators ?? [], signals: parsed.signals ?? [], runs: parsed.runs ?? [] };
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
};
