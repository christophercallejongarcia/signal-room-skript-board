import { randomUUID } from "node:crypto";
import { outlierScorer } from "./adapters/scoring/outlier.ts";
import { getStorage } from "./adapters/storage/index.ts";
import { BRIDGE_TIMEOUT_MS } from "./briefing-run.ts";
import {
  SCRIPT_EVIDENCE_LIMIT,
  SCRIPT_EVIDENCE_TRANSCRIPT_MAX,
  SCRIPT_FRAMEWORK_DEFINITIONS,
  SCRIPT_SOURCE_TRANSCRIPT_MAX,
  newScriptFromIdea,
  parseScriptHooksAnswer,
} from "./scripts.ts";
import { captionExcerpt, selectEvidenceRecords } from "./strategy-evidence.ts";
import { hookOf } from "./hook-source.ts";
import { DevelopConflictError } from "./ideas.ts";
import { STRATEGY_AUDIENCE, STRATEGY_BRIDGE_URL, STRATEGY_GOAL } from "./config.ts";
import type {
  Creator,
  Idea,
  Script,
  ScriptHookEvidenceItem,
  ScriptHooksRequest,
  ScriptFramework,
  SignalRecord,
  RankedSignal,
  StorageAdapter,
} from "./contracts.ts";
import { demoScriptHookOptions } from "./demo-data.ts";

export type ScriptHooksStorage = Pick<
  StorageAdapter,
  | "listCreators"
  | "listSignals"
  | "listIdeas"
  | "listScripts"
  | "saveScript"
  | "claimIdeaDevelop"
  | "settleIdeaDevelop"
  | "claimScriptRun"
  | "settleScriptRun"
>;

export type ScriptHooksBridge = (request: ScriptHooksRequest) => Promise<unknown>;

export type ScriptHooksRunDeps = {
  storage: ScriptHooksStorage;
  bridge: ScriptHooksBridge;
  now: () => Date;
  createId: (prefix: string) => string;
  /** Empty stores use fixed synthetic options and never call the Bridge. */
  demo: boolean;
};

export type ScriptHooksRunResult = {
  idea: Idea;
  script: Script;
  openedExisting?: boolean;
  stale?: boolean;
};

export class ScriptHooksRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptHooksRequestError";
  }
}

function defaultBridge(request: ScriptHooksRequest) {
  return fetch(`${STRATEGY_BRIDGE_URL}/v1/script-hooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  }).then(async (response) => {
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `The bridge answered with HTTP ${response.status}.`);
    }
    return response.json();
  });
}

function defaults(overrides: Partial<ScriptHooksRunDeps>): ScriptHooksRunDeps {
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

function packetItem(signal: SignalRecord, ranked: Map<string, RankedSignal>, creators: Map<string, Creator>, maxTranscript: number): ScriptHookEvidenceItem | null {
  const creator = creators.get(signal.creatorId);
  if (!creator) return null;
  const rankedSignal = ranked.get(signal.id);
  const item: ScriptHookEvidenceItem = {
    id: signal.id,
    title: hookOf(signal) || signal.title,
    creator: creator.handle,
    caption: captionExcerpt(signal.caption),
    plays: signal.plays ?? signal.views,
    outlier: rankedSignal?.outlier ?? 0,
  };
  const transcript = transcriptOf(signal, maxTranscript);
  return transcript ? { ...item, transcript } : item;
}

function frameworkDefinitions() {
  return SCRIPT_FRAMEWORK_DEFINITIONS.map((definition) => ({ ...definition }));
}

async function packetFor(
  idea: Idea,
  signals: SignalRecord[],
  creators: Creator[],
  now: Date,
) {
  const rankedSignals = outlierScorer.rank(signals, creators, now);
  const rankedById = new Map(rankedSignals.map((signal) => [signal.id, signal]));
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));
  const selected = selectEvidenceRecords(rankedSignals, creators, { now: now.getTime(), limit: SCRIPT_EVIDENCE_LIMIT });
  const selectedById = new Map(selected.map((signal) => [signal.id, signal]));
  const sourceSignal = idea.sourceSignalId
    ? signals.find((signal) => signal.id === idea.sourceSignalId && signal.format === "reel")
    : undefined;
  const source = sourceSignal
    ? packetItem(sourceSignal, rankedById, creatorById, SCRIPT_SOURCE_TRANSCRIPT_MAX)
    : null;

  const evidence: ScriptHookEvidenceItem[] = [];
  for (const signal of selected) {
    const item = packetItem(signal, rankedById, creatorById, SCRIPT_EVIDENCE_TRANSCRIPT_MAX);
    if (item) evidence.push(item);
  }
  if (source && !selectedById.has(source.id)) evidence.push(source);
  return { source, evidence };
}

function requestFor(idea: Idea, source: ScriptHookEvidenceItem | null, evidence: ScriptHookEvidenceItem[]): ScriptHooksRequest {
  if (evidence.length === 0) {
    throw new ScriptHooksRequestError("No evidence Reel is available for this Script Hook run.");
  }
  return {
    goal: STRATEGY_GOAL,
    audience: STRATEGY_AUDIENCE,
    idea: { title: idea.title, ...(idea.goal ? { goal: idea.goal } : {}) },
    ...(source ? { source } : {}),
    evidence,
    frameworks: frameworkDefinitions(),
  };
}

async function release(deps: ScriptHooksRunDeps, ideaId: string, ideaRunId: string, scriptId: string | undefined, scriptRunId: string | undefined) {
  const now = deps.now().toISOString();
  if (scriptId && scriptRunId) await deps.storage.settleScriptRun(scriptId, scriptRunId, { now });
  await deps.storage.settleIdeaDevelop(ideaId, ideaRunId, { storyboard: null, now });
}

/**
 * Opens an existing Script or creates one, claims both boundaries, and writes
 * the validated Hook options. A failed Bridge run releases both claims.
 */
export async function runScriptHooks(
  ideaId: string,
  overrides: Partial<ScriptHooksRunDeps> = {},
): Promise<ScriptHooksRunResult | null> {
  const deps = defaults(overrides);
  const [ideas, scripts, signals, creators] = await Promise.all([
    deps.storage.listIdeas(500),
    deps.storage.listScripts(500),
    deps.storage.listSignals(),
    deps.storage.listCreators(),
  ]);
  const idea = ideas.find((candidate) => candidate.id === ideaId);
  if (!idea) return null;

  const existing = scripts.find((candidate) => candidate.ideaId === ideaId);
  if (existing) {
    if (existing.runId || idea.developRunId) throw new DevelopConflictError("This Script already has a Hook-Lauf in progress.");
    // A failed first run leaves the empty Hook-Selection document behind so the
    // next Develop click can retry it. A populated Script is only opened.
    if (existing.status !== "hook-selection" || existing.hookOptions.length > 0) {
      return { idea, script: existing, openedExisting: true };
    }
  }
  if (idea.developRunId) throw new DevelopConflictError("This Idea already has a Develop-Lauf in progress.");

  const now = deps.now();
  const { source, evidence } = await packetFor(idea, signals, creators, now);
  const request = deps.demo ? undefined : requestFor(idea, source, evidence);
  const ideaRunId = deps.createId("develop-run");
  let claimedIdea: Idea | null = null;
  let script: Script | undefined;
  let scriptRunId: string | undefined;

  try {
    const claimed = await deps.storage.claimIdeaDevelop(ideaId, ideaRunId, now.toISOString());
    if (!claimed) return null;
    claimedIdea = claimed;
    script = existing
      ? {
          ...existing,
          evidenceSignalIds: evidence.filter((item) => item.id !== source?.id && item.id !== claimed.sourceSignalId).map((item) => item.id),
          updatedAt: now.toISOString(),
        }
      : newScriptFromIdea(claimed, {
          id: deps.createId("script"),
          now: now.toISOString(),
          evidenceSignalIds: evidence.filter((item) => item.id !== source?.id && item.id !== claimed.sourceSignalId).map((item) => item.id),
        });
    await deps.storage.saveScript(script);
    scriptRunId = deps.createId("script-hook-run");
    const claimedScript = await deps.storage.claimScriptRun(script.id, scriptRunId, now.toISOString());
    if (!claimedScript) throw new Error("The Script disappeared before the Hook-Lauf started.");

    const parsed = deps.demo
      ? { hookOptions: demoScriptHookOptions.map((option) => ({ ...option, evidence: option.evidence.map((item) => ({ ...item })) })), framework: "pas" as ScriptFramework, frameworkReason: "Der Einstieg gewinnt durch einen klaren Engpass, bevor die Lösung kommt." }
      : parseScriptHooksAnswer(await deps.bridge(request as ScriptHooksRequest), (request as ScriptHooksRequest).evidence);
    const settledScript = await deps.storage.settleScriptRun(script.id, scriptRunId, {
      now: deps.now().toISOString(),
      hookOptions: parsed.hookOptions,
      framework: parsed.framework,
      frameworkReason: parsed.frameworkReason,
    });
    if (!settledScript) {
      await deps.storage.settleIdeaDevelop(ideaId, ideaRunId, { storyboard: null, now: deps.now().toISOString() });
      return { idea: claimedIdea, script: claimedScript, stale: true };
    }
    const settledIdea = await deps.storage.settleIdeaDevelop(ideaId, ideaRunId, { storyboard: null, now: deps.now().toISOString() });
    return { idea: settledIdea ?? claimedIdea, script: settledScript };
  } catch (error) {
    if (claimedIdea) {
      await release(deps, ideaId, ideaRunId, script?.id, scriptRunId).catch(() => undefined);
    }
    throw error;
  }
}
