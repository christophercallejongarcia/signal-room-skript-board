#!/usr/bin/env node
/**
 * Supervisor for one engine run or one yt-dlp call (PLAN.md point 39a).
 *
 *   node supervisor.mjs <slotDir> <kind> <slotCount> <graceMs> -- <command> [args…]
 *
 * 1. Takes one of `slotCount` kernel slot locks `<slotDir>/<kind>-<n>.lock`, else exits 75.
 * 2. Starts the child in its own process group and hands it the locked
 *    descriptor as fd 3, so the slot stays taken until supervisor AND child are gone.
 * 3. Reports `{ type: "started", pid, pgid }` over IPC and pipes stdin/stdout/stderr.
 * 4. On SIGTERM, on an IPC "abort" or when the bridge disconnects, it signals
 *    only the child group (SIGTERM, after 2 s SIGKILL) and waits until the group
 *    is empty before it exits itself.
 * The supervisor is never a member of the child group, so it cannot kill itself.
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { tryLock } from "../../lib/board/oslock.mjs";

export const SLOT_BUSY_EXIT = 75;

function groupAlive(pgid) {
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

async function main() {
  const separator = process.argv.indexOf("--");
  const [slotDir, kind, countText, graceText] = process.argv.slice(2, separator);
  // The grace period comes over argv: the supervisor's env is the engine's minimal env.
  const graceMs = Math.max(100, Number.parseInt(graceText, 10) || 2_000);
  const [command, ...args] = process.argv.slice(separator + 1);
  const count = Math.max(1, Number.parseInt(countText, 10) || 1);

  let slot = null;
  for (let n = 1; n <= count && !slot; n += 1) {
    const lock = tryLock(path.join(slotDir, `${kind}-${n}.lock`));
    if (lock) slot = { lock, n };
  }
  if (!slot) {
    process.stderr.write("SLOT_BUSY\n");
    process.exit(SLOT_BUSY_EXIT);
  }
  slot.lock.writeOwner({ supervisorPid: process.pid, kind, slot: slot.n, since: new Date().toISOString() });

  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe", slot.lock.fd], detached: true, cwd: process.cwd(), env: process.env });
  const pgid = child.pid;
  process.send?.({ type: "started", pid: child.pid, pgid, slot: slot.n });

  process.stdin.pipe(child.stdin);
  child.stdin.on("error", () => {});
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    signalGroup(pgid, "SIGTERM");
    setTimeout(() => signalGroup(pgid, "SIGKILL"), graceMs).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("disconnect", stop);
  // The bridge is gone (EPIPE): stop forwarding, keep draining the child's output and end the group in order.
  const lostBridge = (source) => () => {
    source.unpipe();
    source.resume();
    stop();
  };
  process.stdout.on("error", lostBridge(child.stdout));
  process.stderr.on("error", lostBridge(child.stderr));
  process.on("message", (message) => {
    if (message?.type === "abort") stop();
  });

  const closed = new Promise((resolve) => child.on("close", resolve));
  const exit = await new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  // The child may have left grandchildren in its group: end them too, then wait until the group is empty.
  if (groupAlive(pgid)) stop();
  while (groupAlive(pgid)) await new Promise((resolve) => setTimeout(resolve, 50));
  // All output of the child is piped through before the slot goes.
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  slot.lock.release();
  process.exitCode = exit.code ?? (exit.signal ? 128 + 15 : 1);
  // Flush piped output before leaving.
  await new Promise((resolve) => process.stdout.write("", resolve));
  process.disconnect?.();
}

main().catch((error) => {
  process.stderr.write(`supervisor: ${error.message}\n`);
  process.exit(70);
});
