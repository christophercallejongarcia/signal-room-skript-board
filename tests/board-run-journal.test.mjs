import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Run journal of the Next process (PLAN.md points 34a to 34c). */
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sr-board-journal-")));
process.env.SIGNAL_ROOM_BOARD_HOME = home;
process.on("exit", () => fs.rmSync(home, { recursive: true, force: true }));
const { holdInstanceLock, journalFile, journalStatus, readJournal, repairDeadJournals, RunJournal } = await import("../lib/board/run-journal.mjs");
const { answerTitle, answerToMarkdown } = await import("../lib/board/answer.ts");

const DEPLOYMENT = "anonymous:test-deployment";

function journal(runId, owner, { final = false, snapshot = "Teil" } = {}) {
  const entry = new RunJournal({ deploymentId: DEPLOYMENT, ownerInstanceId: owner, runId });
  if (snapshot !== null) entry.snapshot({ seq: 3, hash: "h3", text: snapshot });
  if (final) entry.final({ seq: 4, hash: "h4", text: `${snapshot} und Ende`, status: "complete", usage: { inputTokens: 10, outputTokens: 5 } });
  return entry;
}

/** A process that holds the instance lock of `instanceId` until killed. */
function liveOwner(instanceId) {
  const child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", `import { holdInstanceLock } from ${JSON.stringify(new URL("../lib/board/run-journal.mjs", import.meta.url).href)}; holdInstanceLock(${JSON.stringify(instanceId)}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);`], { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve) => child.stdout.once("data", () => resolve(child)));
}

test("journal keeps header plus the latest entry; the final entry is durable and readable", () => {
  const entry = journal("run-read-00001", "next-dead00000001", { final: true });
  const read = readJournal(entry.file);
  assert.equal(read.header.formatVersion, 1);
  assert.equal(read.header.deploymentId, DEPLOYMENT);
  assert.equal(read.final.text, "Teil und Ende");
  assert.equal(fs.readFileSync(entry.file, "utf8").trim().split("\n").length, 2, "only header and the latest entry");
  assert.equal((fs.statSync(entry.file).mode & 0o777).toString(8), "600");
  entry.remove();
});

test("repair: only dead owners; final entries are delivered, open runs closed as aborted only if the bridge no longer runs them", async () => {
  const owner = await liveOwner("next-alive0000001");
  try {
    const living = journal("run-alive-00001", "next-alive0000001");
    const deadFinal = journal("run-final-00001", "next-dead00000002", { final: true });
    const deadOpen = journal("run-open-000001", "next-dead00000003", { snapshot: "halb" });
    const deadRunning = journal("run-busy-000001", "next-dead00000004");
    const deadFailing = journal("run-fail-000001", "next-dead00000005", { final: true });
    const delivered = [];
    const results = await repairDeadJournals({
      deploymentId: DEPLOYMENT,
      selfInstanceId: "next-self00000000",
      deliver: async (runId, final) => {
        if (runId === "run-fail-000001") throw new Error("Convex weg");
        delivered.push({ runId, status: final.status, text: final.text, code: final.error?.code });
        return true;
      },
      bridgeState: async (runId) => (runId === "run-busy-000001" ? "running" : "finished"),
    });
    const action = Object.fromEntries(results.map((result) => [result.runId, result.action]));
    assert.equal(action["run-alive-00001"], "owner-alive");
    assert.equal(action["run-final-00001"], "delivered");
    assert.equal(action["run-open-000001"], "aborted");
    assert.equal(action["run-busy-000001"], "still-running");
    assert.equal(action["run-fail-000001"], "deliver-failed");
    assert.deepEqual(delivered.sort((a, b) => a.runId.localeCompare(b.runId)), [
      { runId: "run-final-00001", status: "complete", text: "Teil und Ende", code: undefined },
      { runId: "run-open-000001", status: "aborted", text: "halb", code: "interrupted" },
    ]);
    assert.ok(fs.existsSync(living.file), "a living owner's journal stays");
    assert.ok(!fs.existsSync(deadFinal.file) && !fs.existsSync(deadOpen.file));
    assert.ok(fs.existsSync(deadRunning.file) && fs.existsSync(deadFailing.file), "still running or not deliverable: kept");
    const status = Object.fromEntries(journalStatus(DEPLOYMENT).map((entry) => [entry.runId, entry]));
    assert.equal(status["run-alive-00001"].ownerAlive, true);
    assert.equal(status["run-fail-000001"].ownerAlive, false);
    assert.equal(status["run-fail-000001"].hasFinal, true);
    for (const file of [living.file, deadRunning.file, deadFailing.file]) fs.rmSync(file);
  } finally {
    owner.kill("SIGKILL");
  }
});

test("repair never touches journals of another deployment or an unknown format", async () => {
  const foreign = new RunJournal({ deploymentId: "local:other", ownerInstanceId: "next-dead00000009", runId: "run-foreign-001" });
  const unknown = journalFile(DEPLOYMENT, "run-unknown-001");
  fs.writeFileSync(unknown, `${JSON.stringify({ kind: "header", formatVersion: 99, deploymentId: DEPLOYMENT, ownerInstanceId: "next-dead00000009", runId: "run-unknown-001" })}\n`);
  const before = [fs.readFileSync(foreign.file, "utf8"), fs.readFileSync(unknown, "utf8")];
  let calls = 0;
  const results = await repairDeadJournals({ deploymentId: DEPLOYMENT, deliver: async () => (calls += 1) > 0, bridgeState: async () => "finished" });
  assert.equal(calls, 0);
  assert.ok(results.some((result) => result.action === "skipped-foreign"));
  assert.deepEqual([fs.readFileSync(foreign.file, "utf8"), fs.readFileSync(unknown, "utf8")], before);
  assert.equal(journalStatus(DEPLOYMENT).find((entry) => entry.runId === "run-unknown-001").supported, false);
});

test("a second process cannot take the instance lock of a living Next", async () => {
  const owner = await liveOwner("next-lockcheck001");
  try {
    assert.throws(() => holdInstanceLock("next-lockcheck001"), /belegt/);
  } finally {
    owner.kill("SIGKILL");
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const lock = holdInstanceLock("next-lockcheck001");
  lock.release();
});

test("answer as text node: clickable titles become a numbered list, mentions @Titel, media link text; title from the first heading", () => {
  const answer = [
    "## Hook-Ideen für Opus",
    'Basierend auf <poppy_reference_node nodeId="text-a" title="Hook-Formel &quot;K&quot;" type="textNode" /> hier die Hooks:',
    "",
    `<clickable-title titlePrompt="Schreib ein Skript zu '{{titleText}}'">Mehr Effort, mehr Chaos</clickable-title>`,
    `<clickable-title titlePrompt="x">Max ist nicht das Beste</clickable-title>`,
    "1. <clickable-title titlePrompt=\"y\">Schon nummeriert</clickable-title>",
    "![Bild](https://evil.example/pixel.png)",
  ].join("\n");
  const markdown = answerToMarkdown(answer);
  assert.equal(
    markdown,
    ["## Hook-Ideen für Opus", 'Basierend auf @Hook-Formel "K" hier die Hooks:', "", "1. Mehr Effort, mehr Chaos", "2. Max ist nicht das Beste", "1. Schon nummeriert", "[Bild](https://evil.example/pixel.png)"].join("\n"),
  );
  assert.equal(answerTitle(markdown), "Hook-Ideen für Opus");
  assert.equal(answerTitle("Nur Text"), "Antwort");
});
