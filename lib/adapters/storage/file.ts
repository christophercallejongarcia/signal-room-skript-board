import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Creator, SignalRecord, StorageAdapter } from "@/lib/contracts";

type Store = { creators: Creator[]; signals: SignalRecord[] };

const STORE_PATH = path.join(process.cwd(), "data", "store.json");
const EMPTY: Store = { creators: [], signals: [] };

async function load(): Promise<Store> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { creators: parsed.creators ?? [], signals: parsed.signals ?? [] };
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
    await serialized(async () => {
      const store = await load();
      const byId = new Map(store.signals.map((s) => [s.externalId ?? s.id, s]));
      for (const record of records) byId.set(record.externalId ?? record.id, { ...byId.get(record.externalId ?? record.id), ...record });
      store.signals = [...byId.values()];
      await save(store);
    });
  },
};
