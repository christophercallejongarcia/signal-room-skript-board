"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { collectStorageOver } from "../lib/adapters/storage/convex";
import { runBriefing } from "../lib/briefing-run";
import { runRefresh } from "../lib/collect";
import { REFRESH_CREATOR_LIMIT } from "../lib/config";
import type { RefreshResult } from "../lib/contracts";
import { isRefreshHour } from "../lib/refresh-schedule";

/**
 * The daily sweep as the cron runs it: the same runRefresh as POST /api/refresh,
 * so the run it logs is the one the Profile tab already knows, over a storage
 * that talks to this deployment's tables directly. Apify is reached with the
 * deployment's APIFY_TOKEN. What differs from the local refresh: no cover cache
 * (there is no disk here; the next local refresh catches the files up) and no
 * Bridge (the briefing is written without angles).
 */

const NO_COVERS = async () => ({ cached: 0, skipped: 0, failed: 0 });

/**
 * Registered twice in convex/crons.ts (08:00 and 09:00 UTC) because the cron
 * speaks UTC and 10:00 Berlin moves with daylight saving; the slot that is not
 * 10:00 local returns without touching Apify. force skips that guard for a
 * manual run from the dashboard; creatorLimit bounds what such a test costs.
 */
export const run = internalAction({
  args: { force: v.optional(v.boolean()), creatorLimit: v.optional(v.number()) },
  handler: async (ctx, { force, creatorLimit }) => {
    const now = new Date();
    if (!force && !isRefreshHour(now)) {
      console.log(`Refresh slot ${now.toISOString()} is not the local sweep hour; skipping.`);
      return null;
    }
    // Same adapter shape the Next server uses, over this action's own function calls instead of HTTP.
    const storage = collectStorageOver({ query: (ref, args) => ctx.runQuery(ref, args), mutation: (ref, args) => ctx.runMutation(ref, args) });
    const result: RefreshResult = await runRefresh({ storage, cacheCovers: NO_COVERS, creatorLimit: creatorLimit ?? REFRESH_CREATOR_LIMIT });
    console.log(`Refresh ${result.runId}: ${result.creatorsChecked} creators, +${result.recordsAdded} / ~${result.recordsUpdated} records, ${result.errors?.length ?? 0} errors.`);

    // Same order as POST /api/refresh: the briefing reads what the refresh wrote and never replaces the logged run.
    let briefingId: string | undefined;
    try {
      briefingId = (await runBriefing({ storage, withCovers: async (records) => records, angles: false })).id;
    } catch (error) {
      console.error("Briefing after refresh failed:", error instanceof Error ? error.message : error);
    }
    return { ...result, ...(briefingId ? { briefingId } : {}) };
  },
});
