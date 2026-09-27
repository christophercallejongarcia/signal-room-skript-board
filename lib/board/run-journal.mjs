import fs from "node:fs";
import path from "node:path";
import { isLocked, tryLock } from "./oslock.mjs";
import { boardFile, ensureBoardDir } from "./paths.mjs";

/**
 * Run journal of a Next process (PLAN.md points 34a to 34c). Before every
 * Convex write of a run, the snapshot or the final state goes to
 * `~/.signal-room/board/run-journal/<deployment>/<runId>.jsonl`:
 *   line 1  { kind: "header", formatVersion, deploymentId, ownerInstanceId, runId, restoreEpoch, createdAt }
 *   then    { kind: "snapshot", seq, hash, text, reasoning? }   (only the latest is kept)
 *           { kind: "final", seq, hash, text, status, usage?, error?, reasoning? }   (fsync on file and folder)
 * After Convex confirmed the terminal write, the file goes. A process owns its
 * journals as long as it holds `nexts/<instanceId>.lock`; only journals of dead
 * owners may be repaired, each under `<runId>.lock`.
 */
export const JOURNAL_FORMAT = 1;

export function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120) || "unbekannt";
}

export function journalDir(deploymentId) {
  return boardFile("run-journal", safeName(deploymentId));
}

export function journalFile(deploymentId, runId) {
  return path.join(journalDir(deploymentId), `${runId}.jsonl`);
}

/** Kernel lock of a Next instance; held until the process ends (point 34a). */
export function holdInstanceLock(instanceId) {
  ensureBoardDir("nexts");
  const lock = tryLock(boardFile("nexts", `${safeName(instanceId)}.lock`));
  if (!lock) throw new Error(`Instanz-Sperre für ${instanceId} ist belegt.`);
  lock.writeOwner({ instanceId, pid: process.pid, startedAt: new Date().toISOString() });
  return lock;
}

export function instanceAlive(instanceId) {
  return isLocked(boardFile("nexts", `${safeName(instanceId)}.lock`));
}

function fsyncDir(dir) {
  try {
    const fd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // some file systems refuse fsync on folders
  }
}

/** Write header plus one entry atomically (temp file, rename); `durable` adds fsync on file and folder. */
function writeJournal(file, header, entry, durable) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  const text = `${JSON.stringify(header)}\n${entry ? `${JSON.stringify(entry)}\n` : ""}`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, text);
    if (durable) fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  if (durable) fsyncDir(dir);
}

export class RunJournal {
  constructor({ deploymentId, ownerInstanceId, runId, restoreEpoch = 1 }) {
    ensureBoardDir("run-journal", safeName(deploymentId));
    this.file = journalFile(deploymentId, runId);
    this.header = { kind: "header", formatVersion: JOURNAL_FORMAT, deploymentId, ownerInstanceId, runId, restoreEpoch, createdAt: new Date().toISOString() };
    this.last = null;
    writeJournal(this.file, this.header, null, true);
  }

  snapshot(entry) {
    this.last = { kind: "snapshot", ...entry };
    writeJournal(this.file, this.header, this.last, false);
  }

  final(entry) {
    this.last = { kind: "final", ...entry };
    writeJournal(this.file, this.header, this.last, true);
  }

  remove() {
    fs.rmSync(this.file, { force: true });
  }
}

/** Parse a journal file; null if unreadable. */
export function readJournal(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n").filter(Boolean);
  let header = null;
  let snapshot = null;
  let final = null;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.kind === "header") header = entry;
    else if (entry.kind === "snapshot") snapshot = entry;
    else if (entry.kind === "final") final = entry;
  }
  if (!header) return null;
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  return { file, header, snapshot, final, mtimeMs: stat?.mtimeMs ?? 0 };
}

/** All journals of one deployment folder, including foreign or unknown formats (for the status). */
export function listJournals(deploymentId) {
  const dir = journalDir(deploymentId);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  return names.map((name) => readJournal(path.join(dir, name)) ?? { file: path.join(dir, name), header: null, snapshot: null, final: null, mtimeMs: 0 });
}

/**
 * Status of every journal of a deployment, read-only (point 42b): live owner or
 * dead owner, age, supported format. `board:doctor` without `--repair` uses this.
 */
export function journalStatus(deploymentId, now = Date.now()) {
  return listJournals(deploymentId).map((journal) => {
    const header = journal.header;
    const supported = Boolean(header && header.formatVersion === JOURNAL_FORMAT && header.deploymentId === deploymentId);
    return {
      file: journal.file,
      runId: header?.runId ?? path.basename(journal.file, ".jsonl"),
      supported,
      owner: header?.ownerInstanceId ?? null,
      ownerAlive: header ? instanceAlive(header.ownerInstanceId) : false,
      hasFinal: Boolean(journal.final),
      ageMs: now - journal.mtimeMs,
    };
  });
}

/**
 * Repair journals of dead owners (point 34b). Only journals of `deploymentId`
 * with a supported format; each under an exclusive lock. With a final entry it
 * is delivered again (idempotent). Without one, the bridge is asked first; only
 * for "unknown" or "finished" the last snapshot is closed as `aborted`.
 * `deliver(runId, final)` returns true once Convex confirmed a terminal state.
 * `bridgeState(runId)` answers "unknown" | "running" | "finished", or throws.
 */
export async function repairDeadJournals({ deploymentId, deliver, bridgeState, selfInstanceId }) {
  const results = [];
  for (const journal of listJournals(deploymentId)) {
    const header = journal.header;
    if (!header || header.formatVersion !== JOURNAL_FORMAT || header.deploymentId !== deploymentId) {
      results.push({ file: journal.file, action: "skipped-foreign" });
      continue;
    }
    if (header.ownerInstanceId === selfInstanceId || instanceAlive(header.ownerInstanceId)) {
      results.push({ runId: header.runId, action: "owner-alive" });
      continue;
    }
    const lock = tryLock(`${journal.file.slice(0, -".jsonl".length)}.lock`);
    if (!lock) {
      results.push({ runId: header.runId, action: "busy" });
      continue;
    }
    try {
      const fresh = readJournal(journal.file);
      if (!fresh) {
        results.push({ runId: header.runId, action: "gone" });
        continue;
      }
      let final = fresh.final;
      if (!final) {
        let state;
        try {
          state = await bridgeState(header.runId);
        } catch {
          results.push({ runId: header.runId, action: "bridge-unreachable" });
          continue;
        }
        if (state === "running") {
          results.push({ runId: header.runId, action: "still-running" });
          continue;
        }
        const last = fresh.snapshot;
        final = { kind: "final", seq: last?.seq ?? 0, hash: last?.hash ?? "", text: last?.text ?? "", status: "aborted", error: { code: "interrupted", message: "Unterbrochen: Der Board-Server wurde während der Antwort beendet." } };
      }
      const delivered = await deliver(header.runId, final).catch(() => false);
      if (delivered) {
        fs.rmSync(journal.file, { force: true });
        results.push({ runId: header.runId, action: fresh.final ? "delivered" : "aborted" });
      } else results.push({ runId: header.runId, action: "deliver-failed" });
    } finally {
      lock.release();
      fs.rmSync(`${journal.file.slice(0, -".jsonl".length)}.lock`, { force: true });
    }
  }
  return results;
}
