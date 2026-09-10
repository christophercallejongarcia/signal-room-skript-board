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
  ScriptStoryboardRequest,
  SignalRecord,
  StorageAdapter,
  StrategyEvidenceItem,
} from "./contracts.ts";
import { parseForecastAnswer } from "./forecast.ts";
import { hookOf } from "./hook-source.ts";
import { captionExcerpt } from "./strategy-evidence.ts";
import { parseScriptStoryboardAnswer } from "./storyboard.ts";
import { ScriptRunConflictError } from "./scripts.ts";

export type StoryboardRunStorage = Pick<StorageAdapter, "getScript" | "getIdea" | "listSignals" | "listCreators" | "saveIdeaStoryboard" | "claimScriptRun" | "settleScriptRun">;
export type StoryboardBridge = (request: ScriptStoryboardRequest) => Promise<unknown>;
export type StoryboardRunDeps = {
  storage: StoryboardRunStorage;
  bridge: StoryboardBridge;
  now: () => Date;
  createId: () => string;
};

export class StoryboardConflictError extends Error {
  constructor(message = "A Storyboard run is only allowed from an approved Script.") {
    super(message);
    this.name = "StoryboardConflictError";
  }
}

export class StoryboardRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryboardRequestError";
  }
}

export const demoStoryboardAnswer = {
  hook: "Der Bridge-Hook wird nicht gespeichert.",
  beats: [
    { label: "Entscheidung", detail: "Lege fest, was nach fünf Minuten klar sein muss." },
    { label: "Belege", detail: "Wähle drei sichtbare Belege für genau diese Aussage." },
    { label: "Schnitt", detail: "Entferne alles, was keine Entscheidung trägt." },
  ],
  cta: "Prüfe dein nächstes Briefing vor der ersten Revision.",
  caption: "Ein Briefing ist eine Entscheidung.\nDie Belege machen sie sichtbar.",
  takeaway: "Der Zuschauer kann sein nächstes Briefing gezielt kürzen.",
  forecast: {
    comparable: [],
    risk: "Die Auswahl bleibt ohne sichtbares Beispiel zu abstrakt.",
    tension: "Welche eine Entscheidung beendet die nächste Schleife?",
  },
};

function defaultBridge(request: ScriptStoryboardRequest) {
  return fetch(`${STRATEGY_BRIDGE_URL}/v1/storyboard`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  }).then(async (response) => {
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `The Storyboard bridge answered with HTTP ${response.status}.`);
    }
    return response.json();
  });
}

function defaults(overrides: Partial<StoryboardRunDeps>): StoryboardRunDeps {
  return {
    storage: overrides.storage ?? getStorage(),
    bridge: overrides.bridge ?? defaultBridge,
    now: overrides.now ?? (() => new Date()),
    createId: overrides.createId ?? randomUUID,
    ...overrides,
  };
}

function evidenceItem(
  signal: SignalRecord,
  creatorById: ReadonlyMap<string, Creator>,
  rankedById: ReadonlyMap<string, RankedSignal>,
): StrategyEvidenceItem | null {
  const creator = creatorById.get(signal.creatorId);
  if (!creator) return null;
  return {
    title: hookOf(signal) || signal.title,
    creator: creator.handle,
    caption: captionExcerpt(signal.caption),
    plays: signal.plays ?? signal.views,
    outlier: rankedById.get(signal.id)?.outlier ?? 0,
  };
}

function requestFor(
  script: Script,
  idea: Idea,
  signals: SignalRecord[],
  creators: Creator[],
  now: Date,
): ScriptStoryboardRequest {
  const rankedById = new Map(outlierScorer.rank(signals, creators, now).map((signal) => [signal.id, signal]));
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));
  const ids = [script.sourceSignalId, ...script.evidenceSignalIds]
    .filter((id): id is string => Boolean(id))
    .filter((id, index, all) => all.indexOf(id) === index);
  const evidence = ids
    .map((id) => signals.find((signal) => signal.id === id && signal.format === "reel"))
    .filter((signal): signal is SignalRecord => Boolean(signal))
    .map((signal) => evidenceItem(signal, creatorById, rankedById))
    .filter((item): item is StrategyEvidenceItem => Boolean(item));
  if (evidence.length === 0) throw new StoryboardRequestError("No evidence Reel is available for this Storyboard run.");
  return {
    goal: STRATEGY_GOAL,
    audience: STRATEGY_AUDIENCE,
    idea: { title: idea.title, ...(idea.goal ? { goal: idea.goal } : {}) },
    evidence,
    script: { id: script.id, revision: script.revision, sections: script.sections.map((section) => ({ ...section })) },
  };
}

/** Builds and stores a Storyboard only from the currently approved Script revision. */
export async function runScriptStoryboard(
  scriptId: string,
  overrides: Partial<StoryboardRunDeps> = {},
): Promise<{ idea: Idea }> {
  const deps = defaults(overrides);
  const script = await deps.storage.getScript(scriptId);
  if (!script) throw new StoryboardRequestError(`Unknown Script ${scriptId}.`);
  if (script.status !== "approved" || script.approvedRevision !== script.revision) {
    throw new StoryboardConflictError();
  }
  const runId = `storyboard-${deps.createId()}`;
  let claimed: Script | null;
  try {
    claimed = await deps.storage.claimScriptRun(script.id, runId, deps.now().toISOString(), {
      rejectIfRunning: true,
      allowApproved: true,
    });
  } catch (error) {
    if (error instanceof ScriptRunConflictError) {
      throw new StoryboardConflictError("This Script already has a run in progress.");
    }
    throw error;
  }
  if (!claimed) throw new StoryboardRequestError(`Unknown Script ${scriptId}.`);

  try {
    if (claimed.status !== "approved" || claimed.approvedRevision !== claimed.revision) {
      throw new StoryboardConflictError();
    }
    const [idea, signals, creators] = await Promise.all([
      deps.storage.getIdea(claimed.ideaId),
      deps.storage.listSignals(),
      deps.storage.listCreators(),
    ]);
    if (!idea) throw new StoryboardRequestError(`No Idea belongs to Script ${scriptId}.`);
    const request = requestFor(claimed, idea, signals, creators, deps.now());
    const answer = await deps.bridge(request);
    const storyboard = parseScriptStoryboardAnswer(answer, claimed);
    const forecast = parseForecastAnswer(answer, request.evidence);
    const now = deps.now().toISOString();
    const updated = await deps.storage.saveIdeaStoryboard(claimed.ideaId, storyboard, {
      now,
      evidenceCount: request.evidence.length,
      forecast,
    });
    if (!updated) throw new StoryboardRequestError(`No Idea belongs to Script ${scriptId}.`);
    return { idea: updated };
  } finally {
    const released = await deps.storage.settleScriptRun(script.id, runId, { now: deps.now().toISOString() });
    if (!released) throw new StoryboardConflictError("The Storyboard run no longer owns its Script claim.");
  }
}
