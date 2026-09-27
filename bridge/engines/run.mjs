import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logEvent } from "../../lib/board/eventlog.mjs";
import { boardFile, ensureBoardDir } from "../../lib/board/paths.mjs";
import { buildEngineCommand, codexConfiguredModel, ENGINES, prepareRunDir, removeRunDir, resolveBinary } from "./engines.mjs";
import { commandCodeExitError, createLineParser, errorMessage } from "./parse.mjs";
import { registerFile, runSupervised, slotFree } from "./supervised.mjs";

/**
 * One engine run as a stream of events (PLAN.md points 74 to 76, 38, 39a, 39b):
 *   { type: "text-delta", text } | { type: "reasoning-delta", text }
 *   { type: "finish", usage } | { type: "error", code, message }
 * The engine starts sandboxed under a supervisor holding an engine slot; the
 * prompt goes over stdin; the temp folder is removed afterwards. A run ID can
 * start only once: the register and a finished marker in ~/.signal-room/board/runs
 * make that true across bridge instances.
 */
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-engine.mjs");

export class RunRejected extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** Deadlines of point 39b, scalable through env so tests can shorten them. */
export function deadlines(engine, env = process.env) {
  const scale = Number(env.BOARD_ENGINE_TIME_SCALE || 1);
  const ms = (name, fallback) => Number(env[name] || fallback) * scale;
  return {
    firstOutputMs: engine === "codex" ? null : ms("BOARD_ENGINE_FIRST_OUTPUT_MS", 120_000),
    silenceMs: engine === "codex" ? null : ms("BOARD_ENGINE_SILENCE_MS", 90_000),
    totalMs: ms("BOARD_ENGINE_TOTAL_MS", 600_000),
  };
}

export function doneFile(runId) {
  return boardFile("runs", `${runId}.done`);
}

/** Written by another bridge that stopped this run through its supervisor. */
export function abortFile(runId) {
  return boardFile("runs", `${runId}.abort`);
}

/** unknown | running | finished, answered from the shared register (point 33a). */
export function runState(runId) {
  if (fs.existsSync(doneFile(runId))) return "finished";
  if (fs.existsSync(registerFile(runId))) return "running";
  return "unknown";
}

function markFinished(runId, status) {
  ensureBoardDir("runs");
  fs.writeFileSync(doneFile(runId), JSON.stringify({ runId, status, finishedAt: new Date().toISOString() }), { mode: 0o600 });
}

/** A small async queue so the supervisor's callbacks can feed a `for await` consumer. */
function channel() {
  const items = [];
  let wake = null;
  let closed = false;
  return {
    push(item) {
      items.push(item);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (items.length > 0) {
          yield items.shift();
          continue;
        }
        if (closed) return;
        await new Promise((resolve) => (wake = resolve));
        wake = null;
      }
    },
  };
}

function commandFor({ engine, modelId, effort, run, systemFile, env }) {
  const binary = env.BOARD_ENGINE_FAKE === "1" ? `/fake/${engine}` : resolveBinary(engine);
  if (!binary) throw new RunRejected(503, "not-installed", `${ENGINES[engine].label} ist nicht installiert.`);
  const resolvedModel = modelId || (engine === "codex" ? codexConfiguredModel() : undefined);
  const command = buildEngineCommand({ engine, modelId: resolvedModel, effort, run, binary, systemFile });
  if (env.BOARD_ENGINE_FAKE !== "1") return command;
  // Fake mode (tests and E2E, never via request): same argv, but the fake script instead of the binary and no sandbox-exec.
  const binaryIndex = command.args.indexOf(binary);
  const engineArgs = command.args.slice(binaryIndex + 1);
  return { command: process.execPath, args: ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, engine, ...engineArgs], cwd: command.cwd, env: { ...command.env, ...pickFakeEnv(env) } };
}

function pickFakeEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("FAKE_ENGINE_") || key === "BOARD_ENGINE_TIME_SCALE"));
}

/**
 * Start a run. Throws RunRejected before anything starts (duplicate run ID,
 * drain, no free slot); after that, every problem arrives as an `error` event.
 */
export async function startEngineRun({ runId, engine, modelId, effort = "low", prompt, system = null, signal, instanceId, env = process.env }) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(runId)) throw new RunRejected(400, "invalid", "Ungültige runId.");
  if (runState(runId) !== "unknown") throw new RunRejected(409, "duplicate", "Dieser Lauf wurde schon gestartet.");
  if (fs.existsSync(boardFile("drain"))) throw new RunRejected(503, "draining", "Das Board nimmt gerade keine neuen Läufe an (Drain).");
  if (!slotFree("engine")) throw new RunRejected(429, "busy", "Alle Engine-Plätze sind belegt. Gleich erneut senden.", 10);
  // Reserve the run ID exclusively; the supervisor's register later replaces this placeholder.
  ensureBoardDir("runs");
  try {
    fs.writeFileSync(registerFile(runId), JSON.stringify({ runId, state: "starting", ownerInstanceId: instanceId, startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new RunRejected(409, "duplicate", "Dieser Lauf wurde schon gestartet.");
    throw error;
  }

  const run = prepareRunDir(engine, { instanceId });
  let systemFile = null;
  let input = prompt;
  if (system && engine === "claude") {
    systemFile = path.join(run.runDir, "system.txt");
    fs.writeFileSync(systemFile, system, { mode: 0o600 });
  } else if (system) {
    input = `${system}\n\n${prompt}`;
  }
  let command;
  try {
    command = commandFor({ engine, modelId, effort, run, systemFile, env });
  } catch (error) {
    removeRunDir(run.runDir);
    fs.rmSync(registerFile(runId), { force: true });
    throw error;
  }
  let announce;
  const startedOrBusy = new Promise((resolve) => (announce = resolve));

  const events = channel();
  const parse = createLineParser(engine);
  const limits = deadlines(engine, env);
  const started = Date.now();
  const controller = new AbortController();
  let finished = false;
  let errored = false;
  let sawOutput = false;
  let silenceTimer = null;
  let abortReason = null;
  const stop = (reason) => {
    if (abortReason) return;
    abortReason = reason;
    controller.abort();
  };
  signal?.addEventListener("abort", () => stop("aborted"), { once: true });

  const armSilence = () => {
    clearTimeout(silenceTimer);
    const ms = sawOutput ? limits.silenceMs : limits.firstOutputMs;
    if (ms) silenceTimer = setTimeout(() => stop(sawOutput ? "silence" : "first-output"), ms);
  };
  armSilence();

  const onLine = (line) => {
    for (const event of parse(line)) {
      if (event.type === "notice") {
        logEvent({ instanceId, layer: "bridge", runId, engine, phase: `notice:${event.code}` });
        continue;
      }
      if (event.type === "text-delta" || event.type === "reasoning-delta") {
        sawOutput = true;
        armSilence();
      }
      if (event.type === "finish") finished = true;
      if (event.type === "error") errored = true;
      events.push(event);
    }
  };

  const done = runSupervised({ runId, kind: "engine", command: command.command, args: command.args, cwd: command.cwd, env: command.env, input, signal: controller.signal, timeoutMs: limits.totalMs, maxStdoutBytes: 64 * 1024 * 1024, onLine, onStarted: () => announce("started"), onFinished: (result) => {
    if (!result.slotBusy) markFinished(runId, finished ? "complete" : "error");
  }, instanceId, tmpDir: run.runDir }).then((result) => {
    clearTimeout(silenceTimer);
    if (result.slotBusy) {
      // Lost the race for the last slot: nothing ran, the same run ID may be retried.
      removeRunDir(run.runDir);
      announce("busy");
      events.close();
      return result;
    }
    const abortedElsewhere = fs.existsSync(abortFile(runId));
    fs.rmSync(abortFile(runId), { force: true });
    if (!finished && !errored) {
      const reason = result.timedOut ? "total" : (abortReason ?? (abortedElsewhere ? "aborted" : null));
      if (reason === "aborted") events.push({ type: "error", code: "aborted", message: "Abgebrochen." });
      else if (reason === "first-output") events.push({ type: "error", code: "timeout", message: `${ENGINES[engine].label} hat nicht rechtzeitig angefangen zu antworten.` });
      else if (reason === "silence") events.push({ type: "error", code: "timeout", message: `${ENGINES[engine].label} antwortet seit zu langer Zeit nicht mehr.` });
      else if (reason === "total") events.push({ type: "error", code: "timeout", message: `${ENGINES[engine].label} hat die Höchstdauer von ${limits.totalMs >= 60_000 ? `${Math.round(limits.totalMs / 60_000)} Minuten` : `${Math.round(limits.totalMs / 1_000)} Sekunden`} überschritten.` });
      else {
        const byExit = engine === "command-code" ? commandCodeExitError(result.code) : null;
        const loggedOut = /not logged in|login/i.test(result.stderr);
        events.push(byExit ?? { type: "error", code: loggedOut ? "not-logged-in" : "engine-error", message: loggedOut ? errorMessage("not-logged-in", engine) : `${errorMessage("engine-error", engine)} (Exit ${result.code ?? "?"})`, detail: result.stderr.slice(-500) });
      }
    }
    removeRunDir(run.runDir);
    logEvent({ instanceId, layer: "bridge", runId, engine, phase: "run", durationMs: Date.now() - started, code: finished ? "complete" : (abortReason ?? "error") });
    events.close();
    return result;
  });

  if ((await Promise.race([startedOrBusy, done.then(() => "ended")])) === "busy") {
    throw new RunRejected(429, "busy", "Alle Engine-Plätze sind belegt. Gleich erneut senden.", 10);
  }
  return { events, done, abort: () => stop("aborted") };
}

/**
 * `runEngine` as an AsyncIterable of events (point 74). A refusal before the
 * start (duplicate, drain, no slot) arrives as one `error` event with its status.
 */
export async function* runEngine(options) {
  let handle;
  try {
    handle = await startEngineRun(options);
  } catch (error) {
    if (!(error instanceof RunRejected)) throw error;
    yield { type: "error", code: error.code, message: error.message, status: error.status };
    return;
  }
  yield* handle.events;
  await handle.done;
}
