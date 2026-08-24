import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { Creator, Run, SaveResult, SignalRecord, StorageAdapter } from "../../contracts";

/** Uses anyApi so the adapter compiles before `npx convex dev` generates convex/_generated. */
export function createConvexStorage(url: string): StorageAdapter & { upsertCreator(creator: Creator): Promise<void> } {
  const client = new ConvexHttpClient(url);
  return {
    async listCreators() {
      return (await client.query(anyApi.creators.list, {})) as Creator[];
    },
    async addCreator(creator) {
      await client.mutation(anyApi.creators.upsert, { creator });
    },
    async upsertCreator(creator) {
      await client.mutation(anyApi.creators.upsert, { creator });
    },
    async listSignals() {
      return (await client.query(anyApi.signals.list, {})) as SignalRecord[];
    },
    async saveSignals(records) {
      const total: SaveResult = { inserted: 0, updated: 0 };
      for (let i = 0; i < records.length; i += 100) {
        const part = (await client.mutation(anyApi.signals.bulkUpsert, { records: records.slice(i, i + 100) })) as SaveResult;
        total.inserted += part.inserted;
        total.updated += part.updated;
      }
      return total;
    },
    async saveRun(run) {
      await client.mutation(anyApi.runs.upsert, { run });
    },
    async listRuns(limit = 10) {
      return (await client.query(anyApi.runs.list, { limit })) as Run[];
    },
  };
}
