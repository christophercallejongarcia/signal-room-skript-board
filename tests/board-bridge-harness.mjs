/**
 * Shared helpers for the bridge tests with the fake engine (PLAN.md point 79).
 * Each test file uses its own board home, so slots and registers never collide
 * with another file or with a running `dev:board`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const TOKEN = "c".repeat(64);
export const headers = { "x-board-bridge-token": TOKEN, "content-type": "application/json" };

const homes = [];
process.on("exit", () => {
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
});

/** A fresh board home, removed when the test process ends. */
export function tempHome(prefix = "sr-board-chat-") {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  homes.push(home);
  return home;
}

export async function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitUntil(check, { timeoutMs = 10_000, stepMs = 50, label = "Bedingung" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${label} nicht erfüllt nach ${timeoutMs} ms`);
    await sleep(stepMs);
  }
}

/** Start `bridge/server.mjs` in fake mode against `home`. */
export async function startBridge({ home, env = {}, port } = {}) {
  const bridgePort = port ?? (await freePort());
  const proc = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "bridge/server.mjs"], {
    env: {
      ...process.env,
      BRIDGE_PORT: String(bridgePort),
      BOARD_BRIDGE_TOKEN: TOKEN,
      SIGNAL_ROOM_BOARD_HOME: home,
      BOARD_ENGINE_FAKE: "1",
      BOARD_ENGINES_ENABLED: "claude,codex,command-code",
      BOARD_KILL_GRACE_MS: "1500",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (chunk) => (output += chunk));
  proc.stderr.on("data", (chunk) => (output += chunk));
  const base = `http://127.0.0.1:${bridgePort}`;
  const health = await waitUntil(
    async () => {
      if (proc.exitCode !== null) throw new Error(`Bridge beendet: ${output}`);
      try {
        const response = await fetch(`${base}/v1/board/health`, { headers });
        return response.ok ? response.json() : null;
      } catch {
        return null;
      }
    },
    { label: "Bridge-Start" },
  );
  return {
    proc,
    base,
    port: bridgePort,
    instanceId: health.instanceId,
    output: () => output,
    async stop(signal = "SIGTERM") {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      const exited = new Promise((resolve) => proc.once("exit", resolve));
      proc.kill(signal);
      await exited;
    },
  };
}

let counter = 0;
export function newRunId(prefix = "run") {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${counter}`;
}

export function chatBody({ runId = newRunId(), engine = "claude", modelId, text = "Hallo", knowledgeBase = [], brandVoice = null, messages, effort = "low" } = {}) {
  return {
    protocolVersion: 1,
    runId,
    engine,
    modelId: modelId ?? (engine === "claude" ? "sonnet" : engine === "codex" ? "codex-config" : "zai-org/glm-5.3"),
    effort,
    knowledgeBase,
    brandVoice,
    messages: messages ?? [{ role: "user", parts: [{ type: "text", text }] }],
    action: null,
    contextManifest: { youtube: [], texts: [] },
  };
}

/**
 * POST /v1/board/chat and read the NDJSON stream. `onEvent(event, events)` may
 * return "abort" to close the connection from the client side.
 */
export async function chat(base, body, { onEvent, signal } = {}) {
  const controller = new AbortController();
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const response = await fetch(`${base}/v1/board/chat`, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
  if (!response.headers.get("content-type")?.includes("ndjson")) {
    return { status: response.status, json: await response.json().catch(() => null), events: [], retryAfter: response.headers.get("retry-after") };
  }
  const events = [];
  const decoder = new TextDecoder();
  let rest = "";
  const times = [];
  try {
    for await (const chunk of response.body) {
      rest += decoder.decode(chunk, { stream: true });
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        events.push(event);
        times.push(Date.now());
        if (onEvent?.(event, events) === "abort") controller.abort();
      }
    }
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
  }
  const text = events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");
  return { status: response.status, events, times, text, finish: events.find((e) => e.type === "finish"), error: events.find((e) => e.type === "error") };
}

export async function runState(base, runId) {
  const response = await fetch(`${base}/v1/board/runs/${runId}`, { headers });
  return (await response.json()).state;
}

export async function abortRun(base, runId) {
  const response = await fetch(`${base}/v1/board/chat/${runId}/abort`, { method: "POST", headers, body: "{}" });
  return response.json();
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** Peak number of fake engine processes alive at the same time, from start/end lines of FAKE_ENGINE_LOG. */
export function peakConcurrent(entries) {
  const intervals = new Map();
  for (const entry of entries) {
    const interval = intervals.get(entry.pid) ?? {};
    if (entry.at) interval.start = entry.at;
    if (entry.end) interval.end = entry.end;
    intervals.set(entry.pid, interval);
  }
  const points = [...intervals.values()].filter((i) => i.start).flatMap(({ start, end }) => [[start, 1], [end ?? Number.MAX_SAFE_INTEGER, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let running = 0;
  let peak = 0;
  for (const [, delta] of points) {
    running += delta;
    peak = Math.max(peak, running);
  }
  return peak;
}

export function tempDirsOf(instanceId) {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(`sr-board-${instanceId}-`));
}
