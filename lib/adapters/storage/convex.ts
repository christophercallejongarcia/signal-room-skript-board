import { ConvexHttpClient } from "convex/browser";
import { BRIEFING_HISTORY, HOOK_RUN_HISTORY } from "../../config.ts";
import { anyApi } from "convex/server";
import type { Briefing, Creator, FormatReview, HookRun, Idea, Run, SaveResult, SignalRecord, StorageAdapter } from "../../contracts";

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
    async listBriefings(limit = BRIEFING_HISTORY) {
      return (await client.query(anyApi.briefings.list, { limit })) as Briefing[];
    },
    async saveBriefing(briefing) {
      await client.mutation(anyApi.briefings.upsert, { briefing });
    },
    async listFormatReviews(limit = 6) {
      return (await client.query(anyApi.formatReviews.list, { limit })) as FormatReview[];
    },
    async saveFormatReview(review) {
      await client.mutation(anyApi.formatReviews.upsert, { review });
    },
    async listHookRuns(limit = HOOK_RUN_HISTORY) {
      return (await client.query(anyApi.hookRuns.list, { limit })) as HookRun[];
    },
    async saveHookRun(run) {
      await client.mutation(anyApi.hookRuns.upsert, { run });
    },
    async listIdeas(limit = 50) {
      return (await client.query(anyApi.ideas.list, { limit })) as Idea[];
    },
    async saveIdea(idea) {
      await client.mutation(anyApi.ideas.upsert, { idea });
    },
    async claimIdeaDevelop(id, runId, now) {
      return (await client.mutation(anyApi.ideas.claim, { id, runId, now })) as Idea | null;
    },
    async settleIdeaDevelop(id, runId, result) {
      return (await client.mutation(anyApi.ideas.settle, {
        id,
        runId,
        now: result.now,
        storyboard: result.storyboard,
        ...(result.storyboard ? { evidenceCount: result.evidenceCount } : {}),
      })) as Idea | null;
    },
  };
}
