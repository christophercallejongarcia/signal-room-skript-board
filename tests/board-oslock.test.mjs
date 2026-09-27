import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isLocked, tryLock } from "../lib/board/oslock.mjs";

const lockModule = new URL("../lib/board/oslock.mjs", import.meta.url).href;

function tempLockFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-board-lock-"));
  return path.join(dir, "probe.lock");
}

/** A child that takes the lock, prints "locked" or "busy", then idles until killed. */
function holder(file, { inheritTo } = {}) {
  const script = `
    import { tryLock } from ${JSON.stringify(lockModule)};
    import { spawn } from "node:child_process";
    const lock = tryLock(${JSON.stringify(file)});
    if (!lock) { console.log("busy"); process.exit(0); }
    ${inheritTo ? `const child = spawn("sleep", ["30"], { stdio: ["ignore", "ignore", "ignore", lock.fd], detached: true }); console.log("grandchild " + child.pid);` : ""}
    console.log("locked");
    setInterval(() => {}, 1000);
  `;
  const proc = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  const lines = [];
  const ready = new Promise((resolve) => {
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      lines.push(...chunk.trim().split("\n"));
      if (lines.includes("locked") || lines.includes("busy")) resolve(lines);
    });
    proc.on("exit", () => resolve(lines));
  });
  return { proc, ready };
}

function exited(proc) {
  return new Promise((resolve) => (proc.exitCode !== null || proc.signalCode ? resolve() : proc.on("exit", resolve)));
}

test("a second process gets EAGAIN while the first holds the lock", { skip: process.platform !== "darwin" }, async () => {
  const file = tempLockFile();
  const first = holder(file);
  assert.ok((await first.ready).includes("locked"));
  assert.equal(tryLock(file), null);
  assert.equal(isLocked(file), true);
  first.proc.kill("SIGKILL");
  await exited(first.proc);
});

test("SIGKILL of the holder frees the lock immediately", { skip: process.platform !== "darwin" }, async () => {
  const file = tempLockFile();
  const first = holder(file);
  await first.ready;
  first.proc.kill("SIGKILL");
  await exited(first.proc);
  const lock = tryLock(file);
  assert.ok(lock, "lock must be free right after SIGKILL");
  lock.release();
  assert.equal(isLocked(file), false);
});

test("of several simultaneous acquirers exactly one wins", { skip: process.platform !== "darwin" }, async () => {
  const file = tempLockFile();
  const contenders = Array.from({ length: 6 }, () => holder(file));
  const results = await Promise.all(contenders.map((c) => c.ready));
  const winners = results.filter((lines) => lines.includes("locked")).length;
  assert.equal(winners, 1);
  for (const c of contenders) c.proc.kill("SIGKILL");
  await Promise.all(contenders.map((c) => exited(c.proc)));
});

test("a descriptor inherited by a grandchild keeps the lock after the parent dies", { skip: process.platform !== "darwin" }, async () => {
  const file = tempLockFile();
  const parent = holder(file, { inheritTo: true });
  const lines = await parent.ready;
  const grandchildPid = Number(lines.find((line) => line.startsWith("grandchild "))?.split(" ")[1]);
  assert.ok(grandchildPid > 0);
  parent.proc.kill("SIGKILL");
  await exited(parent.proc);
  assert.equal(isLocked(file), true, "grandchild still holds the inherited descriptor");
  process.kill(grandchildPid, "SIGKILL");
  for (let i = 0; i < 50 && isLocked(file); i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(isLocked(file), false);
});

test("in-process: the same process cannot take its own lock twice", { skip: process.platform !== "darwin" }, () => {
  const file = tempLockFile();
  const lock = tryLock(file);
  assert.ok(lock);
  assert.equal(tryLock(file), null);
  lock.release();
  const again = tryLock(file);
  assert.ok(again);
  again.release();
});
