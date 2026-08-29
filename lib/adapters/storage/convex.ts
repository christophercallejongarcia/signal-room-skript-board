import { ConvexHttpClient } from "convex/browser";
import { BRIEFING_HISTORY, HOOK_RUN_HISTORY } from "../../config.ts";
import { anyApi, type FunctionReference } from "convex/server";
import type { CollectStorage } from "../../collect.ts";
import { ConvexError } from "convex/values";
import { ForbiddenMoveError } from "../../ideas.ts";
import type { Briefing, Creator, FormatReview, HookRun, Idea, Run, SaveResult, SignalRecord, StorageAdapter } from "../../contracts";

/**
 * Whoever can call Convex functions: the HTTP client from the Next server, or an
 * action's ctx from inside the deployment (the daily sweep). anyApi references
 * are accepted by both.
 */
export type ConvexCaller = {
  query(ref: FunctionReference<"query">, args: Record<string, unknown>): Promise<unknown>;
  mutation(ref: FunctionReference<"mutation">, args: Record<string, unknown>): Promise<unknown>;
};

export type ConvexCollectStorage = CollectStorage & Pick<StorageAdapter, "saveBriefing">;

/** The slice a collection pass and the briefing after it touch. Declared once for both callers. */
export function collectStorageOver(convex: ConvexCaller): ConvexCollectStorage {
  return {
    async listCreators() {
      return (await convex.query(anyApi.creators.list, {})) as Creator[];
    },
    async upsertCreator(creator) {
      await convex.mutation(anyApi.creators.upsert, { creator });
    },
    async listSignals() {
      return (await convex.query(anyApi.signals.list, {})) as SignalRecord[];
    },
    async saveSignals(records) {
      const total: SaveResult = { inserted: 0, updated: 0 };
      for (let i = 0; i < records.length; i += 100) {
        const part = (await convex.mutation(anyApi.signals.bulkUpsert, { records: records.slice(i, i + 100) })) as SaveResult;
        total.inserted += part.inserted;
        total.updated += part.updated;
      }
      return total;
    },
    async saveRun(run) {
      await convex.mutation(anyApi.runs.upsert, { run });
    },
    async saveBriefing(briefing) {
      await convex.mutation(anyApi.briefings.upsert, { briefing });
    },
  };
}

/** Uses anyApi so the adapter compiles before `npx convex dev` generates convex/_generated. */
export function createConvexStorage(url: string): StorageAdapter & { upsertCreator(creator: Creator): Promise<void> } {
  const client = new ConvexHttpClient(url);
  const shared = collectStorageOver({ query: (ref, args) => client.query(ref, args), mutation: (ref, args) => client.mutation(ref, args) });
  return {
    ...shared,
    async addCreator(creator) {
      await shared.upsertCreator(creator);
    },
    async markSignal(id, savedAt) {
      return (await client.mutation(anyApi.signals.mark, { id, savedAt })) as SignalRecord | null;
    },
    async listRuns(limit = 10) {
      return (await client.query(anyApi.runs.list, { limit })) as Run[];
    },
    async listBriefings(limit = BRIEFING_HISTORY) {
      return (await client.query(anyApi.briefings.list, { limit })) as Briefing[];
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
        ...(result.storyboard ? { evidenceCount: result.evidenceCount, forecast: result.forecast ?? null } : {}),
      })) as Idea | null;
    },
    async moveIdea(id, status, now) {
      try {
        return (await client.mutation(anyApi.ideas.move, { id, status, now })) as Idea | null;
      } catch (error) {
        // The mutation refuses a forbidden move as ConvexError; hand it on as the lib's own error.
        const data = error instanceof ConvexError ? (error.data as { kind?: string; message?: string }) : null;
        if (data?.kind === "forbidden-move") throw new ForbiddenMoveError(data.message ?? "That move is not allowed.");
        throw error;
      }
    },
  };
}
