import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Briefing, Creator, FormatReview, HashtagPost, HookRun, Idea, Run, SignalRecord, Slate, StorageAdapter } from "../../contracts";
import { BRIEFING_HISTORY, HOOK_RUN_HISTORY, SLATE_HISTORY } from "../../config.ts";
import { withSavedAt } from "../../discover-filter.ts";
import { applyStoryboard, claimDevelop, legacyStage, moveIdea, releaseDevelop } from "../../ideas.ts";
import { resetLegacyTranscriptStatuses } from "../../transcripts.ts";
import { mergeSignals } from "../../refresh-window.ts";
import { mergeHashtagPosts } from "../../hashtag-posts.ts";

type Store = {
  creators: Creator[];
  signals: SignalRecord[];
  hashtagPosts: HashtagPost[];
  runs: Run[];
  ideas: Idea[];
  formatReviews: FormatReview[];
  hookRuns: HookRun[];
  briefings: Briefing[];
  slates: Slate[];
};

const STORE_PATH = path.join(process.cwd(), "data", "store.json");
/** Runs kept in the file store; Convex keeps everything. */
const MAX_RUNS = 100;
/** Ideas kept in the file store; Convex keeps everything. */
const MAX_IDEAS = 500;
/** Hook runs kept in the file store; Convex keeps everything. */
const MAX_HOOK_RUNS = 100;
/** Format reviews kept in the file store. One per run date, monthly plus any manual run. */
const MAX_FORMAT_REVIEWS = 24;
/** Briefings kept in the file store. One per day, so this is a quarter of mornings. */
const MAX_BRIEFINGS = 90;
/** Slates kept in the file store. One per day, like the briefings. */
const MAX_SLATES = 90;
const EMPTY: Store = { creators: [], signals: [], hashtagPosts: [], runs: [], ideas: [], formatReviews: [], hookRuns: [], briefings: [], slates: [] };

async function load(): Promise<Store> {
  let parsed: Partial<Store>;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    parsed = JSON.parse(raw) as Partial<Store>;
  } catch {
    return { ...EMPTY };
  }
  // The old parser marked these as final even though it had not read the actor's
  // current response shape. Persist the repair on first load; later loads are no-ops.
  const migrated = resetLegacyTranscriptStatuses(parsed.signals ?? []);
  const store: Store = {
    creators: parsed.creators ?? [],
    signals: migrated.signals,
    hashtagPosts: parsed.hashtagPosts ?? [],
    runs: (parsed.runs ?? []).map((run) =>
      run.transcripts && run.transcripts.failed === undefined
        ? { ...run, transcripts: { ...run.transcripts, failed: 0 } }
        : run,
    ),
    // Ideas written before the six stages land on the matching stage; nothing else changes.
    ideas: (parsed.ideas ?? []).map((idea) => ({ ...idea, status: legacyStage(idea.status) ?? idea.status })),
    formatReviews: parsed.formatReviews ?? [],
    hookRuns: parsed.hookRuns ?? [],
    briefings: parsed.briefings ?? [],
    slates: parsed.slates ?? [],
  };
  if (migrated.reset > 0) await save(store);
  return store;
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
  async listHashtagPosts(limit = 5000) {
    const posts = (await load()).hashtagPosts;
    return [...posts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
  },
  async saveHashtagPosts(posts) {
    return serialized(async () => {
      const store = await load();
      const merged = mergeHashtagPosts(store.hashtagPosts, posts);
      store.hashtagPosts = merged.posts;
      await save(store);
      return { inserted: merged.inserted, updated: merged.updated };
    });
  },
  async markSignal(id, savedAt) {
    return serialized(async () => {
      const store = await load();
      const index = store.signals.findIndex((signal) => signal.id === id);
      if (index < 0) return null;
      const marked = withSavedAt(store.signals[index], savedAt);
      store.signals[index] = marked;
      await save(store);
      return marked;
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
  async listBriefings(limit = BRIEFING_HISTORY) {
    const briefings = (await load()).briefings;
    return [...briefings].sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit);
  },
  async saveBriefing(briefing) {
    await serialized(async () => {
      const store = await load();
      store.briefings = [briefing, ...store.briefings.filter((existing) => existing.id !== briefing.id)]
        .sort((a, b) => b.day.localeCompare(a.day))
        .slice(0, MAX_BRIEFINGS);
      await save(store);
    });
  },
  async listSlates(limit = SLATE_HISTORY) {
    const slates = (await load()).slates;
    return [...slates].sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit);
  },
  async saveSlate(slate) {
    await serialized(async () => {
      const store = await load();
      store.slates = [slate, ...store.slates.filter((existing) => existing.id !== slate.id)]
        .sort((a, b) => b.day.localeCompare(a.day))
        .slice(0, MAX_SLATES);
      await save(store);
    });
  },
  async listFormatReviews(limit = 6) {
    const reviews = (await load()).formatReviews;
    return [...reviews].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).slice(0, limit);
  },
  async saveFormatReview(review) {
    await serialized(async () => {
      const store = await load();
      store.formatReviews = [review, ...store.formatReviews.filter((r) => r.id !== review.id)]
        .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
        .slice(0, MAX_FORMAT_REVIEWS);
      await save(store);
    });
  },
  async listHookRuns(limit = HOOK_RUN_HISTORY) {
    const hookRuns = (await load()).hookRuns;
    return [...hookRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  },
  async saveHookRun(run) {
    await serialized(async () => {
      const store = await load();
      store.hookRuns = [run, ...store.hookRuns.filter((existing) => existing.id !== run.id)].slice(0, MAX_HOOK_RUNS);
      await save(store);
    });
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
            forecast: result.forecast,
          })
        : releaseDevelop(store.ideas[index], runId, result.now);
      // A newer run holds the claim: this result is stale and is dropped.
      if (!settled) return null;
      store.ideas[index] = settled;
      await save(store);
      return settled;
    });
  },
  async moveIdea(id, status, now) {
    return serialized(async () => {
      const store = await load();
      const index = store.ideas.findIndex((idea) => idea.id === id);
      if (index < 0) return null;
      const moved = moveIdea(store.ideas[index], status, now);
      store.ideas[index] = moved;
      await save(store);
      return moved;
    });
  },
};
