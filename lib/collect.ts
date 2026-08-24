import type { Creator, CoverCacheResult } from "@/lib/contracts";
import { collectForCreator } from "@/lib/adapters/sources/apify-instagram";
import { getStorage } from "@/lib/adapters/storage";
import { cacheCovers } from "@/lib/adapters/storage/cover-cache";

/**
 * One collection step for a creator: pull signals (backfill or delta-refresh
 * depending on lastCheckedAt), store them, advance the cursor, cache covers.
 * Idempotent per record and per cover.
 */
export async function collectAndStore(creator: Creator): Promise<{ recordsAdded: number; covers: CoverCacheResult }> {
  const storage = getStorage();
  const records = await collectForCreator(creator);
  await storage.saveSignals(records);
  await storage.upsertCreator({ ...creator, lastCheckedAt: new Date().toISOString() });
  const covers = await cacheCovers(records);
  return { recordsAdded: records.length, covers };
}
