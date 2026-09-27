import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logEvent } from "../../lib/board/eventlog.mjs";
import { isLocked, tryLock } from "../../lib/board/oslock.mjs";
import { boardFile, ensureBoardDir } from "../../lib/board/paths.mjs";
import { endOrphanGroup, groupAlive, processStart } from "./supervised.mjs";

/**
 * Cleanup after dead bridges (PLAN.md points 39, 39c). A run is only touched
 * when its owner bridge AND its supervisor are dead: the owner's kernel lock in
 * `bridges/` can be taken and the supervisor PID is gone or belongs to another
 * process (start time differs). Then the child group ends, the temp folder goes,
 * the register becomes a finished marker. Each register is handled under its
 * own kernel lock, so two bridges never clean the same run twice.
 */
const DONE_MAX_AGE_MS = 7 * 86_400_000;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function instanceAlive(instanceId) {
  if (!instanceId) return false;
  return isLocked(boardFile("bridges", `${instanceId}.lock`));
}

/** Same PID and same start time as recorded: the process is still the one we started. */
export function sameProcess(pid, start) {
  if (!pid || !start) return false;
  return processStart(pid) === start;
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * End the child group of a dead run. A PGID cannot be reused while its group
 * still has members, so a dead leader with living members still means our group.
 * A living leader with a different start time means the PID was reused: hands off.
 */
async function endChildGroup(entry) {
  const pgid = entry.childPgid ?? entry.childPid;
  if (!pgid) return "none";
  if (pidExists(entry.childPid)) {
    if (!sameProcess(entry.childPid, entry.childStart)) return "reused";
  } else if (!groupAlive(pgid)) {
    return "gone";
  }
  await endOrphanGroup(pgid);
  return "ended";
}

export function removeTempDir(dir) {
  if (!dir || !path.basename(dir).startsWith("sr-board-")) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Clean one register if (and only if) owner and supervisor are both dead. */
export async function sweepRun(file, { selfInstanceId } = {}) {
  const runId = path.basename(file, ".json");
  const lock = tryLock(boardFile("runs", `${runId}.cleanup.lock`));
  if (!lock) return { runId, action: "busy" };
  try {
    // Another bridge may have finished this register while we waited for the lock.
    if (!fs.existsSync(file)) return { runId, action: "gone" };
    const entry = readJson(file);
    if (!entry) {
      // Half-written placeholder: only its writer can finish it; leave it if the file is fresh.
      const age = Date.now() - (fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0);
      if (age < 60_000) return { runId, action: "fresh" };
      fs.rmSync(file, { force: true });
      return { runId, action: "removed-broken" };
    }
    if (entry.ownerInstanceId === selfInstanceId || instanceAlive(entry.ownerInstanceId)) return { runId, action: "owner-alive" };
    if (sameProcess(entry.supervisorPid, entry.supervisorStart)) return { runId, action: "supervisor-alive" };
    const group = await endChildGroup(entry);
    removeTempDir(entry.tmpDir);
    if (entry.kind !== "ingest") {
      ensureBoardDir("runs");
      fs.writeFileSync(boardFile("runs", `${runId}.done`), JSON.stringify({ runId, status: "orphaned", finishedAt: new Date().toISOString() }), { mode: 0o600 });
    }
    fs.rmSync(file, { force: true });
    logEvent({ instanceId: selfInstanceId, layer: "bridge", runId, phase: "cleanup", code: group });
    return { runId, action: "cleaned", group };
  } finally {
    lock.release();
    fs.rmSync(boardFile("runs", `${runId}.cleanup.lock`), { force: true });
  }
}

/**
 * Dead bridge instances: a lock file in `bridges/` that we can take has no
 * living owner (point 38a). Their temp folders `sr-board-<id>-*` go first, then
 * the lock file. Only instances registered in this board home count, so a test
 * bridge with its own home never touches the temp folders of another home.
 */
export function sweepDeadInstances({ tmpRoot = os.tmpdir(), selfInstanceId } = {}) {
  const dir = boardFile("bridges");
  let locks = [];
  try {
    locks = fs.readdirSync(dir).filter((name) => name.endsWith(".lock"));
  } catch {
    return { instances: 0, tempDirs: 0 };
  }
  let tempNames = [];
  try {
    tempNames = fs.readdirSync(tmpRoot);
  } catch {
    tempNames = [];
  }
  let instances = 0;
  let tempDirs = 0;
  for (const name of locks) {
    const instanceId = path.basename(name, ".lock");
    if (instanceId === selfInstanceId) continue;
    const file = path.join(dir, name);
    const lock = tryLock(file);
    if (!lock) continue;
    try {
      for (const temp of tempNames) {
        if (!temp.startsWith(`sr-board-${instanceId}-`)) continue;
        removeTempDir(path.join(tmpRoot, temp));
        tempDirs += 1;
      }
      fs.rmSync(file, { force: true });
      instances += 1;
    } finally {
      lock.release();
    }
  }
  return { instances, tempDirs };
}

function sweepDoneMarkers(now = Date.now()) {
  let names = [];
  try {
    names = fs.readdirSync(boardFile("runs")).filter((name) => name.endsWith(".done"));
  } catch {
    return;
  }
  for (const name of names) {
    const file = boardFile("runs", name);
    const mtime = fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? now;
    if (now - mtime > DONE_MAX_AGE_MS) fs.rmSync(file, { force: true });
  }
}

/** One full pass: registers, dead instances with their temp folders, old finished markers. */
export async function sweepAll({ selfInstanceId, tmpRoot } = {}) {
  let names = [];
  try {
    names = fs.readdirSync(boardFile("runs")).filter((name) => name.endsWith(".json"));
  } catch {
    names = [];
  }
  const results = [];
  for (const name of names) results.push(await sweepRun(boardFile("runs", name), { selfInstanceId }));
  const dead = sweepDeadInstances({ tmpRoot, selfInstanceId });
  sweepDoneMarkers();
  return { runs: results, ...dead };
}

/** Start sweeping now and every 30 s (env BOARD_SWEEP_INTERVAL_MS for tests). Returns a stop function. */
export function startSweeper({ selfInstanceId, intervalMs = Number(process.env.BOARD_SWEEP_INTERVAL_MS || 30_000) } = {}) {
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      await sweepAll({ selfInstanceId });
    } catch (error) {
      logEvent({ instanceId: selfInstanceId, layer: "bridge", phase: "cleanup", code: String(error?.code ?? "error") });
    } finally {
      running = false;
    }
  };
  void pass();
  const timer = setInterval(pass, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
