import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { isLocked } from "../../lib/board/oslock.mjs";
import { boardFile, ensureBoardDir } from "../../lib/board/paths.mjs";

/**
 * Start a command under the supervisor (PLAN.md points 38, 39a) and register
 * the run in `~/.signal-room/board/runs/<runId>.json` so a later bridge can
 * clean up after a dead owner. Used for engine runs and every yt-dlp call.
 */
export const SUPERVISOR = path.join(path.dirname(fileURLToPath(import.meta.url)), "supervisor.mjs");
export const SLOT_BUSY_EXIT = 75;

export const SLOT_COUNTS = {
  engine: () => Number(process.env.BOARD_ENGINE_SLOTS || 2),
  ingest: () => Number(process.env.BOARD_INGEST_SLOTS || 2),
};

export function killGraceMs() {
  return Number(process.env.BOARD_KILL_GRACE_MS || 2_000);
}

export function slotsDir() {
  return ensureBoardDir("slots");
}

/** Is any slot of this kind free right now? A hint only; the supervisor decides for real. */
export function slotFree(kind) {
  const count = SLOT_COUNTS[kind]();
  for (let n = 1; n <= count; n += 1) if (!isLocked(path.join(slotsDir(), `${kind}-${n}.lock`))) return true;
  return false;
}

export function processStart(pid) {
  try {
    return execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** Start times of several PIDs with one asynchronous `ps` call, so the event loop never waits for it. */
export function processStarts(pids) {
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-o", "pid=,lstart=", "-p", pids.join(",")], { encoding: "utf8" }, (_error, stdout) => {
      const starts = {};
      for (const line of String(stdout ?? "").split("\n")) {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (match) starts[match[1]] = match[2].trim();
      }
      resolve(starts);
    });
  });
}

export function registerFile(runId) {
  return boardFile("runs", `${runId}.json`);
}

function writeRegister(runId, entry) {
  ensureBoardDir("runs");
  const file = registerFile(runId);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(entry), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * `onFinished(result)` runs before the register goes, so a finished marker never leaves a gap.
 * @returns {Promise<{ code: number | null, slotBusy: boolean, timedOut: boolean, aborted: boolean, overflow: boolean, supervisorKilled: boolean, stdout: string, stderr: string, pid?: number }>}
 */
export function runSupervised({
  runId,
  kind,
  command,
  args = [],
  cwd,
  env,
  input,
  signal,
  timeoutMs = 60_000,
  maxStdoutBytes = 10 * 1024 * 1024,
  onLine,
  onStarted,
  onFinished,
  instanceId = "bridge",
  tmpDir,
}) {
  return new Promise((resolve) => {
    const supervisor = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SUPERVISOR, slotsDir(), kind, String(SLOT_COUNTS[kind]()), String(killGraceMs()), "--", command, ...args], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      detached: true,
    });
    const result = { code: null, slotBusy: false, timedOut: false, aborted: false, overflow: false, supervisorKilled: false, stdout: "", stderr: "", pid: undefined };
    // A dead supervisor turns send() into an error event; the close handler below deals with the rest.
    supervisor.on("error", () => {});
    let stdoutBytes = 0;
    let finished = false;

    const abort = (reason) => {
      if (finished) return;
      if (reason) result[reason] = true;
      try {
        supervisor.send({ type: "abort" });
      } catch {
        try {
          process.kill(supervisor.pid, "SIGTERM");
        } catch {}
      }
    };

    let registered = Promise.resolve();
    supervisor.on("message", (message) => {
      if (message?.type !== "started") return;
      result.pid = message.pid;
      registered = processStarts([supervisor.pid, message.pid]).then((starts) => {
        if (finished) return;
        writeRegister(runId, {
          runId,
          kind,
          ownerInstanceId: instanceId,
          supervisorPid: supervisor.pid,
          supervisorStart: starts[supervisor.pid] ?? null,
          childPid: message.pid,
          childPgid: message.pgid,
          childStart: starts[message.pid] ?? null,
          tmpDir: tmpDir ?? null,
          startedAt: new Date().toISOString(),
        });
      });
      onStarted?.(message);
    });

    const timer = setTimeout(() => abort("timedOut"), timeoutMs);
    const onAbort = () => abort("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });

    if (onLine) {
      const lines = readline.createInterface({ input: supervisor.stdout });
      lines.on("line", (line) => {
        stdoutBytes += Buffer.byteLength(line) + 1;
        if (stdoutBytes > maxStdoutBytes) return abort("overflow");
        onLine(line);
      });
    } else {
      supervisor.stdout.setEncoding("utf8");
      supervisor.stdout.on("data", (chunk) => {
        stdoutBytes += Buffer.byteLength(chunk);
        if (stdoutBytes > maxStdoutBytes) return abort("overflow");
        result.stdout += chunk;
      });
    }
    supervisor.stderr.setEncoding("utf8");
    supervisor.stderr.on("data", (chunk) => {
      result.stderr = (result.stderr + chunk).slice(-8_192);
    });
    supervisor.stdin.on("error", () => {});
    if (input !== undefined) supervisor.stdin.end(input);
    else supervisor.stdin.end();

    supervisor.on("close", async (code, closeSignal) => {
      await registered;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      result.code = code;
      result.slotBusy = code === SLOT_BUSY_EXIT && result.stderr.includes("SLOT_BUSY");
      if (closeSignal === "SIGKILL" && result.pid) {
        // The supervisor died hard while the child may live on and still hold the slot descriptor.
        // This bridge owns the run, so it ends the child group itself and keeps the register until the group is gone.
        result.supervisorKilled = true;
        await endOrphanGroup(result.pid);
      }
      try {
        onFinished?.(result);
      } finally {
        fs.rmSync(registerFile(runId), { force: true });
        resolve(result);
      }
    });
  });
}

export function groupAlive(pgid) {
  try {
    execFileSync("/usr/bin/pgrep", ["-g", String(pgid)], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch {
    // group already gone
  }
}

/** SIGTERM to the group, SIGKILL after the grace period, then wait until no member is left. */
export async function endOrphanGroup(pgid, { graceMs = killGraceMs() } = {}) {
  if (!groupAlive(pgid)) return;
  signalGroup(pgid, "SIGTERM");
  const killAt = Date.now() + graceMs;
  while (groupAlive(pgid)) {
    if (Date.now() >= killAt) signalGroup(pgid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
