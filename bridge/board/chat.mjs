import { execFile } from "node:child_process";
import fs from "node:fs";
import { logEvent } from "../../lib/board/eventlog.mjs";
import { enabledEngines, gateStatus, readGates } from "../../lib/board/gates.mjs";
import { boardFile, ensureBoardDir } from "../../lib/board/paths.mjs";
import { ChatRequestError, parseBoardChatRequest } from "../../lib/board/context.ts";
import { BOARD_MODELS, CODEX_CONFIG_MODEL, ENGINE_BYTE_FACTOR, ENGINE_OVERHEAD_TOKENS, ANSWER_RESERVE_TOKENS, checkBudget } from "../../lib/board/models.ts";
import { renderedBytes, renderPrompt } from "../../lib/board/prompt.ts";
import { PROTOCOL_VERSION } from "../../lib/board/versions.ts";
import { codexConfiguredModel, ENGINE_IDS, ENGINES, engineVersion, profileHash, resolveBinary } from "../engines/engines.mjs";
import { registerFile } from "../engines/supervised.mjs";
import { abortFile, RunRejected, runState, startEngineRun } from "../engines/run.mjs";
import { sameProcess } from "../engines/cleanup.mjs";

/**
 * Chat routes of the bridge (PLAN.md points 76 to 78, 9c):
 *   POST /v1/board/chat                  BoardChatRequestV1 in, NDJSON events out
 *   POST /v1/board/chat/<runId>/abort    stop a run of any bridge instance
 *   GET  /v1/board/runs/<runId>          unknown | running | finished
 *   GET  /v1/board/engines               login, gate, version, models with budgets (60 s cache)
 *   POST /v1/board/drain                 local stop path, works without Convex
 * NDJSON events: start, text-delta, reasoning-delta, finish, error, ping (every 15 s).
 */
const PING_MS = () => Number(process.env.BOARD_CHAT_PING_MS || 15_000);
const ENGINE_CACHE_MS = 60_000;

function execStatus(command, args, env) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 15_000, env, encoding: "utf8" }, (error, stdout) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout ?? "") }));
  });
}

/** Login check per engine without a model call (research 03). */
async function loginStatus(engine, binary) {
  if (!binary) return { loggedIn: false, reason: "nicht installiert" };
  if (engine === "claude") {
    const { code, stdout } = await execStatus(binary, ["auth", "status"], process.env);
    try {
      return { loggedIn: JSON.parse(stdout).loggedIn === true };
    } catch {
      return { loggedIn: code === 0 };
    }
  }
  if (engine === "codex") return { loggedIn: (await execStatus(binary, ["login", "status"], process.env)).code === 0 };
  return { loggedIn: (await execStatus(binary, ["status"], process.env)).code === 0 };
}

function modelsOf(engine, codexModel) {
  return BOARD_MODELS.filter((model) => model.engine === engine).map((model) => ({
    id: model.id,
    label: model.engine === "codex" && codexModel ? `Codex ${codexModel}` : model.label,
    budgetTokens: model.budgetTokens,
    isDefault: Boolean(model.isDefault),
    ...(model.engine === "codex" ? { resolvedId: codexModel ?? null } : {}),
  }));
}

/** Engine status for the model dropdown and for the chat gate check. */
export function createEngineStatus({ env = process.env, now = () => Date.now() } = {}) {
  let cache = null;
  return async function engineStatus({ fresh = false } = {}) {
    if (!fresh && cache && now() - cache.at < ENGINE_CACHE_MS) return cache.value;
    const enabled = enabledEngines(env);
    const fake = env.BOARD_ENGINE_FAKE === "1";
    const gates = readGates();
    const codexModel = fake ? "fake-codex" : codexConfiguredModel();
    const engines = await Promise.all(
      ENGINE_IDS.map(async (engine) => {
        const base = { id: engine, label: ENGINES[engine].label, streams: ENGINES[engine].streams, loginHint: ENGINES[engine].loginHint, models: modelsOf(engine, codexModel), overheadTokens: ENGINE_OVERHEAD_TOKENS[engine], byteFactor: ENGINE_BYTE_FACTOR[engine] };
        if (fake) return { ...base, enabled: enabled.has(engine), version: "fake", installed: true, loggedIn: true, gate: { state: "passed", reason: "Fake-Modus" }, available: enabled.has(engine), reason: enabled.has(engine) ? null : "In BOARD_ENGINES_ENABLED abgeschaltet." };
        const binary = resolveBinary(engine);
        const version = binary ? engineVersion(engine, { binary }) : null;
        const gate = version ? gateStatus(engine, { version, profileHash: profileHash(engine) }, gates) : { state: "unchecked", reason: "Nicht installiert." };
        const login = await loginStatus(engine, binary);
        let reason = null;
        if (!enabled.has(engine)) reason = "In BOARD_ENGINES_ENABLED abgeschaltet.";
        else if (!binary) reason = `${ENGINES[engine].label} ist nicht installiert.`;
        else if (gate.state !== "passed") reason = `Ungeprüft: ${gate.reason} Bitte \`npm run board:gate\` ausführen.`;
        else if (!login.loggedIn) reason = `Nicht eingeloggt. ${ENGINES[engine].loginHint}`;
        return { ...base, enabled: enabled.has(engine), version, installed: Boolean(binary), loggedIn: login.loggedIn, gate, available: reason === null, reason };
      }),
    );
    const value = { engines, answerReserveTokens: ANSWER_RESERVE_TOKENS, checkedAt: new Date(now()).toISOString() };
    cache = { at: now(), value };
    return value;
  };
}

function writeLine(response, event) {
  if (response.writableEnded || response.destroyed) return;
  response.write(`${JSON.stringify(event)}\n`);
}

/** Stop a run owned by another bridge: its supervisor ends the child group on SIGTERM. */
function abortForeign(runId) {
  let entry = null;
  try {
    entry = JSON.parse(fs.readFileSync(registerFile(runId), "utf8"));
  } catch {
    return false;
  }
  if (!sameProcess(entry.supervisorPid, entry.supervisorStart)) return false;
  try {
    // The owner reads this marker and reports "aborted" instead of an engine error.
    fs.writeFileSync(abortFile(runId), runId, { mode: 0o600 });
    process.kill(entry.supervisorPid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export function chatRoutes({ instance, readJson, bodyLimit, env = process.env }) {
  const active = new Map();
  const engineStatus = createEngineStatus({ env });

  const chat = {
    method: "POST",
    pattern: /^\/v1\/board\/chat$/,
    async handle({ request, response, send }) {
      const started = Date.now();
      const body = await readJson(request, bodyLimit());
      let chatRequest;
      try {
        chatRequest = parseBoardChatRequest(body);
      } catch (error) {
        if (error instanceof ChatRequestError) return send(error.status, { error: error.message, code: error.status === 409 ? "version" : "invalid" });
        throw error;
      }
      const { runId, engine } = chatRequest;
      const status = (await engineStatus()).engines.find((entry) => entry.id === engine);
      if (!status?.available) return send(409, { error: `${ENGINES[engine].label}: ${status?.reason ?? "nicht verfügbar"}`, code: status?.enabled === false ? "engine-disabled" : status?.gate?.state !== "passed" ? "engine-unchecked" : status?.loggedIn === false ? "not-logged-in" : "engine-unavailable" });

      const rendered = renderPrompt(chatRequest);
      const budget = checkBudget(engine, chatRequest.modelId, renderedBytes(rendered));
      if (!budget.ok) return send(413, { error: `Kontext zu groß für ${ENGINES[engine].label}: geschätzt ${budget.estimatedTokens} von ${budget.budgetTokens} Tokens.`, code: "budget", budget });

      const controller = new AbortController();
      let handle;
      try {
        handle = await startEngineRun({
          runId,
          engine,
          modelId: engine === "codex" && chatRequest.modelId === CODEX_CONFIG_MODEL ? undefined : chatRequest.modelId,
          effort: chatRequest.effort,
          prompt: rendered.prompt,
          system: rendered.system,
          signal: controller.signal,
          instanceId: instance.instanceId,
          env,
        });
      } catch (error) {
        if (error instanceof RunRejected) {
          logEvent({ instanceId: instance.instanceId, layer: "bridge", runId, engine, phase: "chat-rejected", code: error.code, status: error.status });
          return send(error.status, { error: error.message, code: error.code }, error.retryAfter ? { "retry-after": String(error.retryAfter) } : {});
        }
        throw error;
      }
      active.set(runId, { abort: () => controller.abort(), engine, startedAt: started });

      response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      // Abort only when the response closes before we finished it; a closed request body means nothing (point 76).
      response.on("close", () => {
        if (!response.writableFinished) controller.abort();
      });
      const ping = setInterval(() => writeLine(response, { type: "ping" }), PING_MS());
      writeLine(response, { type: "start", protocolVersion: PROTOCOL_VERSION, runId, engine, modelId: chatRequest.modelId, instanceId: instance.instanceId, budget });
      try {
        for await (const event of handle.events) writeLine(response, event);
        await handle.done;
      } finally {
        clearInterval(ping);
        active.delete(runId);
        response.end();
      }
    },
  };

  const abort = {
    method: "POST",
    pattern: /^\/v1\/board\/chat\/([A-Za-z0-9_-]{8,100})\/abort$/,
    async handle({ params, send }) {
      const [runId] = params;
      const local = active.get(runId);
      if (local) {
        local.abort();
        return send(200, { ok: true, runId, state: "aborting", owner: "self" });
      }
      const state = runState(runId);
      if (state === "running" && abortForeign(runId)) return send(200, { ok: true, runId, state: "aborting", owner: "other" });
      return send(200, { ok: true, runId, state });
    },
  };

  const runs = {
    method: "GET",
    pattern: /^\/v1\/board\/runs\/([A-Za-z0-9_-]{8,100})$/,
    handle({ params, send }) {
      const [runId] = params;
      return send(200, { runId, state: runState(runId) });
    },
  };

  const engines = {
    method: "GET",
    pattern: /^\/v1\/board\/engines$/,
    async handle({ url, send }) {
      return send(200, await engineStatus({ fresh: url.searchParams.get("fresh") === "1" }));
    },
  };

  const drain = {
    method: "POST",
    pattern: /^\/v1\/board\/drain$/,
    async handle({ request, send }) {
      const body = await readJson(request, 16 * 1024).catch(() => ({}));
      const file = boardFile("drain");
      if (body.resume === true) {
        fs.rmSync(file, { force: true });
        logEvent({ instanceId: instance.instanceId, layer: "bridge", phase: "drain", code: "resume" });
        return send(200, { draining: false });
      }
      ensureBoardDir();
      fs.writeFileSync(file, JSON.stringify({ since: new Date().toISOString(), by: instance.instanceId }), { mode: 0o600 });
      let aborted = 0;
      if (body.abortRunning === true) {
        for (const run of active.values()) {
          run.abort();
          aborted += 1;
        }
      }
      logEvent({ instanceId: instance.instanceId, layer: "bridge", phase: "drain", code: "on", count: aborted });
      return send(200, { draining: true, aborted, running: active.size });
    },
  };

  return { routes: [chat, abort, runs, engines, drain], active, engineStatus };
}
