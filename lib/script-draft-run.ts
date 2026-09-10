import { randomUUID } from "node:crypto";
import { outlierScorer } from "./adapters/scoring/outlier.ts";
import { getStorage } from "./adapters/storage/index.ts";
import { BRIDGE_TIMEOUT_MS } from "./briefing-run.ts";
import { STRATEGY_AUDIENCE, STRATEGY_BRIDGE_URL, STRATEGY_GOAL } from "./config.ts";
import type {
  Creator,
  Idea,
  RankedSignal,
  Script,
  ScriptDraftRequest,
  ScriptFramework,
  ScriptHookEvidenceItem,
  SignalRecord,
  StorageAdapter,
} from "./contracts.ts";
import { captionExcerpt } from "./strategy-evidence.ts";
import { hookOf } from "./hook-source.ts";
import { demoScriptDraftSections, parseScriptDraftAnswer } from "./script-draft.ts";
import {
  SCRIPT_EVIDENCE_TRANSCRIPT_MAX,
  SCRIPT_FRAMEWORK_DEFINITIONS,
  SCRIPT_FRAMEWORKS,
  SCRIPT_SOURCE_TRANSCRIPT_MAX,
  ScriptRunConflictError,
} from "./scripts.ts";

export type ScriptDraftStorage = Pick<StorageAdapter, "getScript" | "listIdeas" | "listSignals" | "listCreators" | "claimScriptRun" | "settleScriptRun">;
export type ScriptDraftBridge = (request: ScriptDraftRequest) => Promise<unknown>;
export type ScriptDraftInput = { selectedHookId: string; framework: ScriptFramework };
export type ScriptDraftRunDeps = {
  storage: ScriptDraftStorage;
  bridge: ScriptDraftBridge;
  now: () => Date;
  createId: (prefix: string) => string;
  demo: boolean;
};
export type ScriptDraftRunResult = { script: Script; stale?: boolean };

export class ScriptDraftConflictError extends Error {
  constructor(message = "A Draft run is only allowed from Hook-Selection or Draft.") {
    super(message);
    this.name = "ScriptDraftConflictError";
  }
}

export class ScriptDraftRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptDraftRequestError";
  }
}

function line(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Parses the narrow browser body for POST /api/scripts/<id>/draft. */
export function parseScriptDraftInput(value: unknown): ScriptDraftInput {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const selectedHookId = line(input.selectedHookId, 200);
  if (!selectedHookId) throw new ScriptDraftRequestError("selectedHookId required");
  if (typeof input.framework !== "string" || !SCRIPT_FRAMEWORKS.includes(input.framework as ScriptFramework)) {
    throw new ScriptDraftRequestError(`framework must be one of ${SCRIPT_FRAMEWORKS.join(", ")}`);
  }
  return { selectedHookId, framework: input.framework as ScriptFramework };
}

function defaultBridge(request: ScriptDraftRequest) {
  return fetch(`${STRATEGY_BRIDGE_URL}/v1/script-draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  }).then(async (response) => {
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `The Draft bridge answered with HTTP ${response.status}.`);
    }
    return response.json();
  });
}

function defaults(overrides: Partial<ScriptDraftRunDeps>): ScriptDraftRunDeps {
  return {
    storage: overrides.storage ?? getStorage(),
    bridge: overrides.bridge ?? defaultBridge,
    now: overrides.now ?? (() => new Date()),
    createId: overrides.createId ?? ((prefix) => `${prefix}-${randomUUID()}`),
    demo: overrides.demo ?? false,
    ...overrides,
  };
}

function transcriptOf(signal: SignalRecord, max: number) {
  const transcript = signal.transcriptWorkingCopy?.trim() || signal.transcript?.trim() || "";
  return transcript ? transcript.slice(0, max) : undefined;
}

function packetItem(
  signal: SignalRecord,
  rankedById: ReadonlyMap<string, RankedSignal>,
  creatorById: ReadonlyMap<string, Creator>,
  maxTranscript: number,
): ScriptHookEvidenceItem | null {
  const creator = creatorById.get(signal.creatorId);
  if (!creator) return null;
  const ranked = rankedById.get(signal.id);
  const item: ScriptHookEvidenceItem = {
    id: signal.id,
    title: hookOf(signal) || signal.title,
    creator: creator.handle,
    caption: captionExcerpt(signal.caption),
    plays: signal.plays ?? signal.views,
    outlier: ranked?.outlier ?? 0,
  };
  const transcript = transcriptOf(signal, maxTranscript);
  return transcript ? { ...item, transcript } : item;
}

function requestFor(
  script: Script,
  idea: Idea,
  input: ScriptDraftInput,
  signals: SignalRecord[],
  creators: Creator[],
  now: Date,
): ScriptDraftRequest {
  const selectedHook = script.hookOptions.find((option) => option.id === input.selectedHookId);
  if (!selectedHook) throw new ScriptDraftRequestError(`Unknown hook option ${input.selectedHookId}.`);
  const ranked = outlierScorer.rank(signals, creators, now);
  const rankedById = new Map(ranked.map((signal) => [signal.id, signal]));
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));
  const sourceSignal = script.sourceSignalId ? signals.find((signal) => signal.id === script.sourceSignalId && signal.format === "reel") : undefined;
  const source = sourceSignal ? packetItem(sourceSignal, rankedById, creatorById, SCRIPT_SOURCE_TRANSCRIPT_MAX) : null;
  const evidence = script.evidenceSignalIds
    .map((id) => signals.find((signal) => signal.id === id && signal.format === "reel"))
    .filter((signal): signal is SignalRecord => Boolean(signal))
    .map((signal) => packetItem(signal, rankedById, creatorById, SCRIPT_EVIDENCE_TRANSCRIPT_MAX))
    .filter((item): item is ScriptHookEvidenceItem => Boolean(item));
  if (source && !evidence.some((item) => item.id === source.id)) evidence.push(source);
  if (evidence.length === 0) throw new ScriptDraftRequestError("No evidence Reel is available for this Draft run.");
  return {
    goal: STRATEGY_GOAL,
    audience: STRATEGY_AUDIENCE,
    idea: { title: idea.title, ...(idea.goal ? { goal: idea.goal } : {}) },
    ...(source ? { source } : {}),
    evidence,
    frameworks: SCRIPT_FRAMEWORK_DEFINITIONS.map((definition) => ({ ...definition })),
    selectedHook: { hook: selectedHook.hook, angle: selectedHook.angle },
    framework: input.framework,
  };
}

async function release(deps: ScriptDraftRunDeps, scriptId: string, runId: string) {
  await deps.storage.settleScriptRun(scriptId, runId, { now: deps.now().toISOString() });
}

/** Claims, generates, validates and fully replaces one Script Draft. */
export async function runScriptDraft(
  scriptId: string,
  input: ScriptDraftInput,
  overrides: Partial<ScriptDraftRunDeps> = {},
): Promise<ScriptDraftRunResult | null> {
  const deps = defaults(overrides);
  const script = await deps.storage.getScript(scriptId);
  if (!script) return null;
  if (script.runId) throw new ScriptDraftConflictError("This Script already has a run in progress.");
  if (script.status !== "hook-selection" && script.status !== "draft") throw new ScriptDraftConflictError();
  const runId = deps.createId("script-draft-run");
  let claimed = false;

  try {
    const claimedScript = await deps.storage.claimScriptRun(scriptId, runId, deps.now().toISOString(), { rejectIfRunning: true });
    if (!claimedScript) return null;
    claimed = true;
    if (claimedScript.status !== "hook-selection" && claimedScript.status !== "draft") throw new ScriptDraftConflictError();
    const [ideas, signals, creators] = await Promise.all([
      deps.storage.listIdeas(500),
      deps.storage.listSignals(),
      deps.storage.listCreators(),
    ]);
    const idea = ideas.find((candidate) => candidate.id === claimedScript.ideaId);
    if (!idea) throw new ScriptDraftRequestError(`No Idea belongs to Script ${scriptId}.`);
    const request = requestFor(claimedScript, idea, input, signals, creators, deps.now());
    const sections = deps.demo
      ? demoScriptDraftSections(request.selectedHook.hook)
      : parseScriptDraftAnswer(await deps.bridge(request), request).sections;
    const settled = await deps.storage.settleScriptRun(scriptId, runId, {
      now: deps.now().toISOString(),
      status: "draft",
      framework: input.framework,
      selectedHookId: input.selectedHookId,
      sections,
    });
    if (!settled) return { script: claimedScript, stale: true };
    return { script: settled };
  } catch (error) {
    if (claimed) {
      try {
        await release(deps, scriptId, runId);
      } catch (releaseError) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        const releaseMessage = releaseError instanceof Error ? releaseError.message : String(releaseError);
        throw new Error(`${originalMessage} The Draft claim could not be released: ${releaseMessage}`, { cause: error });
      }
    }
    if (error instanceof ScriptRunConflictError) throw new ScriptDraftConflictError(error.message);
    throw error;
  }
}
