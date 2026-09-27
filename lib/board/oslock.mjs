import fs from "node:fs";
import path from "node:path";

/**
 * Kernel file locks for everything the board coordinates across processes
 * (export locks, run and ingest slots, bridge and Next liveness).
 *
 * macOS takes the lock at open time with the BSD flag O_EXLOCK; O_NONBLOCK
 * turns "wait" into EAGAIN. The kernel drops the lock when the last
 * descriptor closes, including after SIGKILL, so no lock can be orphaned and
 * nobody ever has to "take over" a stale one. Owner data inside the file is
 * diagnostics only, never the source of truth.
 */
export const O_EXLOCK = 0x20;
const { O_RDWR, O_CREAT, O_NONBLOCK } = fs.constants;
const LOCK_FLAGS = O_RDWR | O_CREAT | O_NONBLOCK | O_EXLOCK;

export function lockingSupported() {
  return process.platform === "darwin";
}

/**
 * Try to take an exclusive lock on `file` without waiting.
 * Returns `{ fd, release, writeOwner }` on success, `null` if another process holds it.
 */
export function tryLock(file, { mode = 0o600 } = {}) {
  if (!lockingSupported()) throw new Error("Kernel-Sperren brauchen macOS (O_EXLOCK).");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let fd;
  try {
    fd = fs.openSync(file, LOCK_FLAGS, mode);
  } catch (error) {
    if (error && (error.code === "EAGAIN" || error.code === "EWOULDBLOCK")) return null;
    throw error;
  }
  let released = false;
  return {
    fd,
    file,
    writeOwner(owner) {
      if (released) return;
      const text = `${JSON.stringify(owner)}\n`;
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, text, 0, "utf8");
    },
    release() {
      if (released) return;
      released = true;
      fs.closeSync(fd);
    },
  };
}

/** True when some live process holds the lock on `file`. Never leaves a lock behind. */
export function isLocked(file) {
  if (!fs.existsSync(file)) return false;
  const lock = tryLock(file);
  if (!lock) return true;
  lock.release();
  return false;
}

/** Owner diagnostics written by the holder, or null. */
export function readOwner(file) {
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Take the first free lock among `files`, in order. Returns the lock plus its index, or null. */
export function tryLockAny(files) {
  for (let index = 0; index < files.length; index += 1) {
    const lock = tryLock(files[index]);
    if (lock) return { lock, index };
  }
  return null;
}
