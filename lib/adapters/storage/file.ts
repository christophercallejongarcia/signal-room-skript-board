import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Briefing, Creator, FormatReview, HashtagPost, HookRun, Idea, Run, Script, ScriptPatch, ScriptRunClaimOptions, SignalRecord, Slate, StorageAdapter, TranscriptAnalysis, TranscriptDictionaryEntry, TranscriptSignalPatch, SettleTranscriptAnalysis } from "../../contracts";
import { BRIEFING_HISTORY, HOOK_RUN_HISTORY, SLATE_HISTORY } from "../../config.ts";
import { withSavedAt } from "../../discover-filter.ts";
import { applyStoryboard, attachStoryboard, claimDevelop, DevelopConflictError, legacyStage, moveIdea, releaseDevelop } from "../../ideas.ts";
import { claimScriptRun, moveScript, patchScript, settleScriptRun, validateScriptWrite } from "../../scripts.ts";
import { resetLegacyTranscriptStatuses, transcriptConflictReason, TranscriptConflictError } from "../../transcripts.ts";
import { mergeSignals } from "../../refresh-window.ts";
import { mergeHashtagPosts } from "../../hashtag-posts.ts";
import { mergeTranscriptDictionaryEntries, normalizeTranscriptDictionary, removeTranscriptDictionaryEntry } from "../../transcript-dictionary.ts";
import { applyCoverUpdate } from "../../cover-lab.ts";
import { analysisText, createTranscriptAnalysis, hashTranscriptText, validateTranscriptAnalysisSettlement, TRANSCRIPT_ANALYSIS_CLAIM_TIMEOUT_MS, TRANSCRIPT_ANALYSIS_MAX_ATTEMPTS, type TranscriptAnalysisChunkState } from "../../transcript-analysis.ts";

type Store = {
  creators: Creator[];
  signals: SignalRecord[];
  transcriptDictionary: TranscriptDictionaryEntry[];
  hashtagPosts: HashtagPost[];
  runs: Run[];
  ideas: Idea[];
  scripts: Script[];
  formatReviews: FormatReview[];
  hookRuns: HookRun[];
  briefings: Briefing[];
  slates: Slate[];
  transcriptAnalyses: TranscriptAnalysis[];
};
const STORE_PATH = path.join(process.cwd(), "data", "store.json");
/** Runs kept in the file store; Convex keeps everything. */
const MAX_RUNS = 100;
/** Ideas kept in the file store; Convex keeps everything. */
const MAX_IDEAS = 500;
/** Scripts kept in the file store; Convex keeps everything. */
const MAX_SCRIPTS = 500;
/** Hook runs kept in the file store; Convex keeps everything. */
const MAX_HOOK_RUNS = 100;
/** Format reviews kept in the file store. One per run date, monthly plus any manual run. */
const MAX_FORMAT_REVIEWS = 24;
/** Briefings kept in the file store. One per day, so this is a quarter of mornings. */
const MAX_BRIEFINGS = 90;
/** Slates kept in the file store. One per day, like the briefings. */
const MAX_SLATES = 90;
const EMPTY: Store = { creators: [], signals: [], transcriptDictionary: [], hashtagPosts: [], runs: [], ideas: [], scripts: [], formatReviews: [], hookRuns: [], briefings: [], slates: [], transcriptAnalyses: [] };

function signalKey(signal: Pick<SignalRecord, "id" | "externalId">) {
  return signal.externalId ?? signal.id;
}

function queueForSignal(store: Store, signal: SignalRecord, now: string) {
  if (signal.format !== "reel" || !signal.transcript?.trim() || (signal.transcriptStatus !== undefined && signal.transcriptStatus !== "ready")) return;
  const analysis = createTranscriptAnalysis(signal, now);
  if (!analysis || store.transcriptAnalyses.some((existing) => existing.id === analysis.id)) return;
  store.transcriptAnalyses.push(analysis);
}

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
    transcriptDictionary: normalizeTranscriptDictionary(parsed.transcriptDictionary ?? []),
    hashtagPosts: parsed.hashtagPosts ?? [],
    runs: (parsed.runs ?? []).map((run) =>
      run.transcripts && run.transcripts.failed === undefined
        ? { ...run, transcripts: { ...run.transcripts, failed: 0 } }
        : run,
    ),
    // Ideas written before the six stages land on the matching stage; nothing else changes.
    ideas: (parsed.ideas ?? []).map((idea) => ({ ...idea, status: legacyStage(idea.status) ?? idea.status })),
    scripts: parsed.scripts ?? [],
    formatReviews: parsed.formatReviews ?? [],
    hookRuns: parsed.hookRuns ?? [],
    briefings: parsed.briefings ?? [],
    slates: parsed.slates ?? [],
    transcriptAnalyses: parsed.transcriptAnalyses ?? [],
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

/** Applies the narrow transcript port without letting it overwrite metrics or savedAt. */
function applyTranscriptPatch(signal: SignalRecord, patch: TranscriptSignalPatch): SignalRecord {
  const next = { ...signal };
  if ("transcript" in patch) {
    if (patch.transcript === null || patch.transcript === undefined) delete next.transcript;
    else next.transcript = patch.transcript;
  }
  if ("transcriptSegments" in patch) {
    if (patch.transcriptSegments === null || patch.transcriptSegments === undefined) delete next.transcriptSegments;
    else next.transcriptSegments = patch.transcriptSegments;
  }
  if ("transcriptAttempts" in patch) {
    if (patch.transcriptAttempts === undefined) delete next.transcriptAttempts;
    else next.transcriptAttempts = patch.transcriptAttempts;
  }
  if ("transcriptUpdatedAt" in patch) {
    if (patch.transcriptUpdatedAt === undefined) delete next.transcriptUpdatedAt;
    else next.transcriptUpdatedAt = patch.transcriptUpdatedAt;
  }
  if ("transcriptError" in patch) {
    if (patch.transcriptError === null || patch.transcriptError === undefined) delete next.transcriptError;
    else next.transcriptError = patch.transcriptError;
  }
  if ("transcriptStatus" in patch) {
    if (patch.transcriptStatus === null || patch.transcriptStatus === undefined) delete next.transcriptStatus;
    else next.transcriptStatus = patch.transcriptStatus;
  }
  if ("transcriptWorkingCopy" in patch) {
    if (patch.transcriptWorkingCopy === null || patch.transcriptWorkingCopy === undefined) delete next.transcriptWorkingCopy;
    else next.transcriptWorkingCopy = patch.transcriptWorkingCopy;
  }
  if ("transcriptCorrections" in patch) {
    if (patch.transcriptCorrections === null || patch.transcriptCorrections === undefined) delete next.transcriptCorrections;
    else next.transcriptCorrections = patch.transcriptCorrections;
  }
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
      const storedByKey = new Map(store.signals.map((signal) => [signalKey(signal), signal]));
      for (const record of records) {
        const stored = storedByKey.get(signalKey(record));
        if (stored) queueForSignal(store, stored, new Date().toISOString());
      }
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
  async claimTranscript(id, now) {
    return serialized(async () => {
      const store = await load();
      const index = store.signals.findIndex((signal) => signal.id === id);
      if (index < 0) return null;
      const signal = store.signals[index];
      const blocked = transcriptConflictReason(signal, new Date(now));
      if (blocked === "pending") throw new TranscriptConflictError("pending", "A transcript attempt is already in progress.");
      if (blocked === "ready") throw new TranscriptConflictError("ready", "This Reel already has a transcript.");
      const claimed = applyTranscriptPatch(signal, {
        transcriptStatus: "pending",
        transcriptAttempts: Math.max(0, Math.floor(signal.transcriptAttempts ?? 0)) + 1,
        transcriptUpdatedAt: now,
        transcriptError: null,
        // A new actor answer starts a new review chain. The original transcript remains.
        transcriptWorkingCopy: null,
        transcriptCorrections: null,
      });
      store.signals[index] = claimed;
      await save(store);
      return claimed;
    });
  },
  async patchTranscript(id, patch) {
    return serialized(async () => {
      const store = await load();
      const index = store.signals.findIndex((signal) => signal.id === id);
      if (index < 0) return null;
      const patched = applyTranscriptPatch(store.signals[index], patch);
      store.signals[index] = patched;
      queueForSignal(store, patched, patch.transcriptUpdatedAt ?? new Date().toISOString());
      await save(store);
      return patched;
    });
  },
  async listTranscriptAnalyses(options = {}) {
    const analyses = (await load()).transcriptAnalyses;
    return [...analyses]
      .filter((analysis) => !options.signalId || analysis.signalId === options.signalId)
      .filter((analysis) => !options.analysisId || analysis.id === options.analysisId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 500));
  },
  async enqueueTranscriptAnalysis(signalId, now) {
    return serialized(async () => {
      const store = await load();
      const signal = store.signals.find((candidate) => candidate.id === signalId);
      if (!signal) return null;
      queueForSignal(store, signal, now);
      const analysis = store.transcriptAnalyses
        .filter((candidate) => candidate.signalId === signalId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
      await save(store);
      return analysis;
    });
  },
  async claimTranscriptAnalysis(now, claimId, analysisId) {
    return serialized(async () => {
      const store = await load();
      const nowMs = Date.parse(now);
      for (let index = 0; index < store.transcriptAnalyses.length; index += 1) {
        const analysis = store.transcriptAnalyses[index];
        if (analysis.status === "running" && analysis.attempts >= TRANSCRIPT_ANALYSIS_MAX_ATTEMPTS && Date.parse(analysis.claimExpiresAt ?? "") <= nowMs) {
          store.transcriptAnalyses[index] = {
            ...analysis,
            status: "failed",
            error: "The analysis attempt limit was reached after an expired claim.",
            claimId: undefined,
            claimedAt: undefined,
            claimExpiresAt: undefined,
          };
        }
      }
      const candidate = [...store.transcriptAnalyses]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .filter((analysis) => !analysisId || analysis.id === analysisId)
        .find((analysis) => (
          analysis.attempts < TRANSCRIPT_ANALYSIS_MAX_ATTEMPTS
          && (analysis.status === "queued" || (analysis.status === "running" && Number.isFinite(Date.parse(analysis.claimExpiresAt ?? "")) && Date.parse(analysis.claimExpiresAt!) <= nowMs))
        ));
      if (!candidate) return null;
      const claimed = {
        ...candidate,
        status: "running" as const,
        attempts: candidate.attempts + 1,
        claimedAt: now,
        claimExpiresAt: new Date(nowMs + TRANSCRIPT_ANALYSIS_CLAIM_TIMEOUT_MS).toISOString(),
        claimId,
        error: undefined,
      };
      const index = store.transcriptAnalyses.findIndex((analysis) => analysis.id === candidate.id);
      store.transcriptAnalyses[index] = claimed;
      await save(store);
      return claimed;
    });
  },
  async settleTranscriptAnalysis(id, claimId, result: SettleTranscriptAnalysis) {
    return serialized(async () => {
      const store = await load();
      const index = store.transcriptAnalyses.findIndex((analysis) => analysis.id === id);
      if (index < 0 || store.transcriptAnalyses[index].claimId !== claimId) return null;
      const current = store.transcriptAnalyses[index];
      const signal = store.signals.find((candidate) => candidate.id === current.signalId);
      const source = signal ? analysisText(signal) : null;
      if (!source || source.textVersion !== current.textVersion || hashTranscriptText(source.text) !== current.textHash) return null;
      validateTranscriptAnalysisSettlement(result, source.text);
      const settled: TranscriptAnalysis = {
        ...current,
        status: result.status,
        ...(result.framework === undefined ? {} : { framework: result.framework }),
        ...(result.findings === undefined ? {} : { findings: result.findings }),
        ...(result.chunks === undefined ? {} : { chunks: result.chunks as TranscriptAnalysisChunkState[] }),
        ...(result.textLength === undefined ? {} : { textLength: result.textLength }),
        ...(result.complete === undefined ? {} : { complete: result.complete }),
        ...(result.status === "failed" ? { error: result.error || "Transcript analysis failed." } : { error: undefined, completedAt: result.now }),
        claimedAt: undefined,
        claimExpiresAt: undefined,
        claimId: undefined,
      };
      store.transcriptAnalyses[index] = settled;
      await save(store);
      return settled;
    });
  },
  async retryTranscriptAnalysis(id, now) {
    return serialized(async () => {
      const store = await load();
      const index = store.transcriptAnalyses.findIndex((analysis) => analysis.id === id);
      if (index < 0) return null;
      const current = store.transcriptAnalyses[index];
      if (current.status !== "failed") throw new Error("Only failed analyses can be retried.");
      if (current.attempts >= TRANSCRIPT_ANALYSIS_MAX_ATTEMPTS) throw new Error("The analysis attempt limit has been reached.");
      store.transcriptAnalyses[index] = { ...current, status: "queued", error: undefined, createdAt: now, claimedAt: undefined, claimExpiresAt: undefined, claimId: undefined };
      await save(store);
      return store.transcriptAnalyses[index];
    });
  },
  async listTranscriptDictionary() {
    return (await load()).transcriptDictionary;
  },
  async addTranscriptDictionary(entry) {
    return serialized(async () => {
      const normalized = normalizeTranscriptDictionary([entry])[0];
      if (!normalized) throw new Error("Dictionary entries need different, non-empty wrong and right text.");
      const store = await load();
      store.transcriptDictionary = mergeTranscriptDictionaryEntries(store.transcriptDictionary, normalized);
      await save(store);
      return store.transcriptDictionary.find((candidate) => candidate.wrong === normalized.wrong) ?? normalized;
    });
  },
  async removeTranscriptDictionary(entry) {
    return serialized(async () => {
      const store = await load();
      const removed = store.transcriptDictionary.find(
        (candidate) => candidate.wrong === entry.wrong && candidate.right === entry.right,
      ) ?? null;
      store.transcriptDictionary = removeTranscriptDictionaryEntry(store.transcriptDictionary, entry);
      if (removed) await save(store);
      return removed;
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
  async getIdea(id) {
    return (await load()).ideas.find((idea) => idea.id === id) ?? null;
  },
  async saveIdea(idea) {
    await serialized(async () => {
      const store = await load();
      store.ideas = [idea, ...store.ideas.filter((existing) => existing.id !== idea.id)].slice(0, MAX_IDEAS);
      await save(store);
    });
  },
  async saveIdeaStoryboard(id, storyboard, options) {
    return serialized(async () => {
      const store = await load();
      const index = store.ideas.findIndex((idea) => idea.id === id);
      if (index < 0) return null;
      const updated = attachStoryboard(store.ideas[index], storyboard, options);
      store.ideas[index] = updated;
      await save(store);
      return updated;
    });
  },
  async saveIdeaCover(id, update) {
    return serialized(async () => {
      const store = await load();
      const index = store.ideas.findIndex((idea) => idea.id === id);
      if (index < 0) return null;
      const updated = applyCoverUpdate(store.ideas[index], update);
      store.ideas[index] = updated;
      await save(store);
      return updated;
    });
  },
  async claimIdeaDevelop(id, runId, now) {
    return serialized(async () => {
      const store = await load();
      const index = store.ideas.findIndex((idea) => idea.id === id);
      if (index < 0) return null;
      if (store.ideas[index].developRunId && store.ideas[index].developRunId !== runId) {
        throw new DevelopConflictError("This Idea already has a Develop-Lauf in progress.");
      }
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
  async listScripts(limit = 50) {
    const scripts = (await load()).scripts;
    return [...scripts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  },
  async getScript(id) {
    return (await load()).scripts.find((script) => script.id === id) ?? null;
  },
  async saveScript(script) {
    await serialized(async () => {
      const store = await load();
      validateScriptWrite(store.scripts.find((existing) => existing.id === script.id) ?? null, script);
      store.scripts = [script, ...store.scripts.filter((existing) => existing.id !== script.id)].slice(0, MAX_SCRIPTS);
      await save(store);
    });
  },
  async patchScript(id, patch: ScriptPatch, now) {
    return serialized(async () => {
      const store = await load();
      const index = store.scripts.findIndex((script) => script.id === id);
      if (index < 0) return null;
      const patched = patchScript(store.scripts[index], patch, now);
      store.scripts[index] = patched;
      await save(store);
      return patched;
    });
  },
  async claimScriptRun(id, runId, now, options?: ScriptRunClaimOptions) {
    return serialized(async () => {
      const store = await load();
      const index = store.scripts.findIndex((script) => script.id === id);
      if (index < 0) return null;
      const claimed = claimScriptRun(store.scripts[index], runId, now, options);
      store.scripts[index] = claimed;
      await save(store);
      return claimed;
    });
  },
  async settleScriptRun(id, runId, result) {
    return serialized(async () => {
      const store = await load();
      const index = store.scripts.findIndex((script) => script.id === id);
      if (index < 0) return null;
      const settled = settleScriptRun(store.scripts[index], runId, result);
      if (!settled) return null;
      store.scripts[index] = settled;
      await save(store);
      return settled;
    });
  },
  async moveScript(id, status, now) {
    return serialized(async () => {
      const store = await load();
      const index = store.scripts.findIndex((script) => script.id === id);
      if (index < 0) return null;
      const moved = moveScript(store.scripts[index], status, now);
      store.scripts[index] = moved;
      await save(store);
      return moved;
    });
  },
};
