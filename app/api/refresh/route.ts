import { NextResponse } from "next/server";
import type { CoverCacheResult, RefreshResult } from "@/lib/contracts";
import { getStorage } from "@/lib/adapters/storage";
import { cacheCovers } from "@/lib/adapters/storage/cover-cache";
import { collectAndStore } from "@/lib/collect";

export const runtime = "nodejs";
export const maxDuration = 300;

function addCounts(a: CoverCacheResult, b: CoverCacheResult): CoverCacheResult {
  return { cached: a.cached + b.cached, skipped: a.skipped + b.skipped, failed: a.failed + b.failed };
}

/** Delta-Refresh: pulls only posts newer than each creator's lastCheckedAt, then catches up missing covers. */
export async function POST() {
  const storage = getStorage();
  const creators = (await storage.listCreators()).filter((c) => c.network === "instagram");
  let recordsAdded = 0;
  let covers: CoverCacheResult = { cached: 0, skipped: 0, failed: 0 };
  const errors: string[] = [];

  for (const creator of creators) {
    try {
      const step = await collectAndStore(creator);
      recordsAdded += step.recordsAdded;
      covers = addCounts(covers, step.covers);
    } catch (error) {
      errors.push(`${creator.handle}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Second pass over the stored corpus: a cover that failed on an earlier run
  // is retried as long as its CDN link still resolves. Already cached files are skipped.
  const catchUp = await cacheCovers(await storage.listSignals());
  covers = { cached: covers.cached + catchUp.cached, skipped: catchUp.skipped, failed: catchUp.failed };

  const result: RefreshResult = {
    creatorsChecked: creators.length,
    recordsAdded,
    completedAt: new Date().toISOString(),
    covers,
    errors,
  };
  return NextResponse.json(result);
}
