import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { abortRun, alive, chat, chatBody, headers, peakConcurrent, readLog, runState, sleep, startBridge, tempDirsOf, tempHome, waitUntil } from "./board-bridge-harness.mjs";

/**
 * Several bridge instances on one board home, and the supervisor (PLAN.md
 * points 38, 38a, 39, 39a, 39c, 79). Slots are kernel locks in the shared home,
 * so they count across instances.
 */
function register(home, runId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, "runs", `${runId}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function started(home, runId) {
  const entry = await waitUntil(() => register(home, runId)?.childPid && register(home, runId), { label: `Lauf ${runId} gestartet` });
  // The fake logs its start only after its signal handlers are in place.
  await waitUntil(() => readLog(path.join(home, "fake.jsonl")).some((line) => line.pid === entry.childPid && line.at), { label: "Fake bereit" });
  return entry;
}

test("two bridges: restarting B leaves A's run alone; three runs over two instances give exactly one 429", { timeout: 60_000 }, async () => {
  const home = tempHome();
  const log = path.join(home, "fake.jsonl");
  const env = { FAKE_ENGINE_LOG: log };
  const a = await startBridge({ home, env });
  let b = await startBridge({ home, env });
  try {
    const runA = chatBody({ text: "[[fake:stream=6000]]" });
    const runB = chatBody({ text: "[[fake:stream=60000]]" });
    const pendingA = chat(a.base, runA);
    const pendingB = chat(b.base, runB).catch((error) => ({ error }));
    await started(home, runA.runId);
    await started(home, runB.runId);
    await b.stop();
    b = await startBridge({ home, env });
    const resultB = await pendingB;
    assert.equal(resultB.finish, undefined, "B's own run ended with B");
    const resultA = await pendingA;
    assert.ok(resultA.finish, `A's run finished normally: ${JSON.stringify(resultA.error)}`);

    const three = [chatBody({ text: "[[fake:stream=3000]]" }), chatBody({ text: "[[fake:stream=3000]]" }), chatBody({ text: "[[fake:stream=3000]]" })];
    const results = await Promise.all([chat(a.base, three[0]), chat(a.base, three[1]), chat(b.base, three[2])]);
    assert.equal(results.filter((r) => r.status === 429).length, 1, `statuses ${results.map((r) => r.status)}`);
    assert.equal(results.filter((r) => r.finish).length, 2);
    assert.ok(results.find((r) => r.status === 429).retryAfter);
    assert.ok(peakConcurrent(readLog(log)) <= 2, "never more than two engine processes");
  } finally {
    await a.stop();
    await b.stop();
  }
});

test("SIGKILL of bridge A: B answers at once, A's slot stays taken until A's whole group is gone, B cleans A's register", { timeout: 60_000 }, async () => {
  const home = tempHome();
  // A long grace period: the engine ignores SIGTERM and must still hold the slot while B is asked.
  const env = { BOARD_ENGINE_SLOTS: "1", BOARD_SWEEP_INTERVAL_MS: "2000", BOARD_KILL_GRACE_MS: "4000", FAKE_ENGINE_LOG: path.join(home, "fake.jsonl") };
  const a = await startBridge({ home, env });
  const b = await startBridge({ home, env });
  try {
    const run = chatBody({ text: "[[fake:child]] [[fake:ignore-term]] [[fake:stream=60000]]" });
    void chat(a.base, run).catch(() => {});
    const entry = await started(home, run.runId);
    const killedAt = Date.now();
    await a.stop("SIGKILL");

    const health = await fetch(`${b.base}/v1/board/health`, { headers });
    assert.equal(health.status, 200);
    assert.ok(Date.now() - killedAt < 1_000, "B answers without a restart");
    const busy = await chat(b.base, chatBody());
    assert.equal(busy.status, 429, "A's slot is still held by its group");
    assert.ok(alive(entry.childPid), "the engine ignores SIGTERM and lives until SIGKILL");

    const next = await waitUntil(async () => {
      const result = await chat(b.base, chatBody());
      return result.status === 200 ? result : null;
    }, { timeoutMs: 15_000, stepMs: 200, label: "Slot frei" });
    assert.ok(next.finish);
    assert.equal(alive(entry.childPid), false, "the slot came free only after the group ended");

    await waitUntil(() => register(home, run.runId) === null, { timeoutMs: 30_000, label: "Register von A aufgeräumt" });
    assert.equal(await runState(b.base, run.runId), "finished");
    assert.deepEqual(tempDirsOf(a.instanceId), []);
  } finally {
    await a.stop("SIGKILL");
    await b.stop();
  }
});

test("hard death of bridge and supervisor: the restarted bridge ends the orphaned group and removes the temp folder", { timeout: 60_000 }, async () => {
  const home = tempHome();
  const log = path.join(home, "fake.jsonl");
  const first = await startBridge({ home, env: { FAKE_ENGINE_LOG: log } });
  const run = chatBody({ text: "[[fake:child]] [[fake:hang]]" });
  void chat(first.base, run).catch(() => {});
  const entry = await started(home, run.runId);
  const grandchild = readLog(log).find((line) => line.pid === entry.childPid && line.child).child;
  // Freeze the supervisor so it cannot react to the bridge's death, then kill both.
  process.kill(entry.supervisorPid, "SIGSTOP");
  await first.stop("SIGKILL");
  process.kill(entry.supervisorPid, "SIGKILL");
  await sleep(200);
  assert.ok(alive(entry.childPid) && alive(grandchild), "the engine group survives both deaths");
  assert.ok(fs.existsSync(entry.tmpDir));

  const second = await startBridge({ home });
  try {
    await waitUntil(() => !alive(entry.childPid) && !alive(grandchild), { timeoutMs: 10_000, label: "Gruppe beendet" });
    await waitUntil(() => !fs.existsSync(entry.tmpDir) && register(home, run.runId) === null, { label: "aufgeräumt" });
    assert.equal(await runState(second.base, run.runId), "finished");
    assert.equal(fs.existsSync(path.join(home, "bridges", `${first.instanceId}.lock`)), false, "the dead instance lock is gone");
  } finally {
    await second.stop();
  }
});

test("supervisor: an engine that ignores SIGTERM keeps the slot until SIGKILL", { timeout: 60_000 }, async () => {
  const home = tempHome();
  const bridge = await startBridge({ home, env: { BOARD_ENGINE_SLOTS: "1" } });
  try {
    const run = chatBody({ text: "[[fake:ignore-term]] [[fake:stream=60000]]" });
    let abortedAt = 0;
    const pending = chat(bridge.base, run, {
      onEvent: (event) => {
        if (event.type === "text-delta" && !abortedAt) {
          abortedAt = Date.now();
          void abortRun(bridge.base, run.runId);
        }
      },
    });
    await waitUntil(() => abortedAt, { label: "abgebrochen" });
    await sleep(100);
    const replacement = await chat(bridge.base, chatBody());
    assert.equal(replacement.status, 429, "slot still held during the grace period");
    const result = await pending;
    assert.equal(result.error?.code, "aborted");
    assert.ok(Date.now() - abortedAt >= 1_400, `ended after ${Date.now() - abortedAt} ms, before SIGKILL`);
    assert.ok((await chat(bridge.base, chatBody())).finish, "slot free after the group is gone");
  } finally {
    await bridge.stop();
  }
});

test("supervisor killed while the engine lives: the slot stays taken and a replacement gets 429 until the engine is gone", { timeout: 60_000 }, async () => {
  const home = tempHome();
  const bridge = await startBridge({ home, env: { BOARD_ENGINE_SLOTS: "1", BOARD_KILL_GRACE_MS: "4000", FAKE_ENGINE_LOG: path.join(home, "fake.jsonl") } });
  try {
    const run = chatBody({ text: "[[fake:ignore-term]] [[fake:hang]]" });
    const pending = chat(bridge.base, run);
    const entry = await started(home, run.runId);
    process.kill(entry.supervisorPid, "SIGKILL");
    await waitUntil(() => !alive(entry.supervisorPid), { label: "Supervisor tot" });
    assert.ok(alive(entry.childPid));
    const replacement = await chat(bridge.base, chatBody());
    assert.equal(replacement.status, 429);
    await waitUntil(() => !alive(entry.childPid), { timeoutMs: 10_000, label: "Engine beendet" });
    const result = await pending;
    assert.equal(result.finish, undefined);
    assert.ok(result.error);
    const after = await waitUntil(async () => {
      const attempt = await chat(bridge.base, chatBody());
      return attempt.status === 200 ? attempt : null;
    }, { label: "Slot frei" });
    assert.ok(after.finish);
  } finally {
    await bridge.stop();
  }
});
