import { execFileSync, spawn } from "node:child_process";
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
 * @returns {Promise<{ code: number | null, slotBusy: boolean, timedOut: boolean, aborted: boolean, overflow: boolean, stdout: string, stderr: string, pid?: number }>}
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
  instanceId = "bridge",
  tmpDir,
}) {
  return new Promise((resolve) => {
    const supervisor = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SUPERVISOR, slotsDir(), kind, String(SLOT_COUNTS[kind]()), "--", command, ...args], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      detached: true,
    });
    const result = { code: null, slotBusy: false, timedOut: false, aborted: false, overflow: false, stdout: "", stderr: "", pid: undefined };
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

    supervisor.on("message", (message) => {
      if (message?.type !== "started") return;
      result.pid = message.pid;
      writeRegister(runId, {
        runId,
        kind,
        ownerInstanceId: instanceId,
        supervisorPid: supervisor.pid,
        supervisorStart: processStart(supervisor.pid),
        childPid: message.pid,
        childPgid: message.pgid,
        childStart: processStart(message.pid),
        tmpDir: tmpDir ?? null,
        startedAt: new Date().toISOString(),
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

    supervisor.on("close", (code) => {
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      result.code = code;
      result.slotBusy = code === SLOT_BUSY_EXIT && result.stderr.includes("SLOT_BUSY");
      fs.rmSync(registerFile(runId), { force: true });
      resolve(result);
    });
  });
}
