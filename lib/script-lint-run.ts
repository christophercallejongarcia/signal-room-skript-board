import { randomUUID } from "node:crypto";
import { getStorage } from "./adapters/storage/index.ts";
import { BRIDGE_TIMEOUT_MS } from "./briefing-run.ts";
import { STRATEGY_BRIDGE_URL } from "./config.ts";
import type { Script, ScriptLintRequest, ScriptLintSuggestion, StorageAdapter } from "./contracts.ts";
import { demoScriptLintSuggestions } from "./demo-data.ts";
import { ForbiddenMoveError } from "./ideas.ts";
import { parseScriptLintResponse, scriptLintSections } from "./script-lint.ts";
import { ScriptRunConflictError } from "./scripts.ts";

export type ScriptLintStorage = Pick<StorageAdapter, "getScript" | "claimScriptRun" | "settleScriptRun">;
export type ScriptLintBridge = (request: ScriptLintRequest) => Promise<unknown>;

export type ScriptLintRunDeps = {
  storage: ScriptLintStorage;
  bridge: ScriptLintBridge;
  now: () => Date;
  createId: (prefix: string) => string;
  demo: boolean;
};

export type ScriptLintRunResult = {
  script: Script;
  suggestions: ScriptLintSuggestion[];
  stale?: boolean;
};

export class ScriptLintConflictError extends Error {
  constructor(message = "This Script already has a Lektorat-Lauf in progress.") {
    super(message);
    this.name = "ScriptLintConflictError";
  }
}

export class ScriptLintRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptLintRequestError";
  }
}

function defaultBridge(request: ScriptLintRequest) {
  return fetch(`${STRATEGY_BRIDGE_URL}/v1/script-lint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  }).then(async (response) => {
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `The Lektorat bridge answered with HTTP ${response.status}.`);
    }
    return response.json();
  });
}

function defaults(overrides: Partial<ScriptLintRunDeps>): ScriptLintRunDeps {
  return {
    storage: overrides.storage ?? getStorage(),
    bridge: overrides.bridge ?? defaultBridge,
    now: overrides.now ?? (() => new Date()),
    createId: overrides.createId ?? ((prefix) => `${prefix}-${randomUUID()}`),
    demo: overrides.demo ?? false,
    ...overrides,
  };
}

function requestFor(script: Script): ScriptLintRequest {
  const sections = scriptLintSections(script);
  if (sections.length === 0) throw new ScriptLintRequestError("A Script needs a complete draft before the Lektorat-Lauf.");
  return { sections };
}

async function release(deps: ScriptLintRunDeps, scriptId: string, runId: string) {
  await deps.storage.settleScriptRun(scriptId, runId, { now: deps.now().toISOString() });
}

/** Runs both Slop stages through the Bridge and leaves the Script unchanged. */
export async function runScriptLint(
  scriptId: string,
  overrides: Partial<ScriptLintRunDeps> = {},
): Promise<ScriptLintRunResult | null> {
  const deps = defaults(overrides);
  const script = await deps.storage.getScript(scriptId);
  if (!script) return null;
  if (script.runId) throw new ScriptLintConflictError();
  if (script.status === "approved") throw new ForbiddenMoveError("An approved script is immutable until it is reopened.");
  const runId = deps.createId("script-lint-run");
  let claimed = false;

  try {
    const claimedScript = await deps.storage.claimScriptRun(scriptId, runId, deps.now().toISOString(), { rejectIfRunning: true });
    if (!claimedScript) return null;
    claimed = true;
    const request = requestFor(claimedScript);
    const raw = deps.demo ? { suggestions: demoScriptLintSuggestions } : await deps.bridge(request);
    const suggestions = parseScriptLintResponse(raw, request.sections);
    const settled = await deps.storage.settleScriptRun(scriptId, runId, { now: deps.now().toISOString() });
    if (!settled) return { script: claimedScript, suggestions, stale: true };
    return { script: settled, suggestions };
  } catch (error) {
    if (claimed) await release(deps, scriptId, runId).catch(() => undefined);
    if (error instanceof ScriptRunConflictError) throw new ScriptLintConflictError(error.message);
    throw error;
  }
}
