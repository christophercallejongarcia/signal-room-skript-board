import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { boardIdOf, bridgeRunState, chat, connectTo, createChatNode, createTextNode, journalDir, journalFiles, sleep, startNext, waitFor, withConvexStopped, type NextInstance, type RunInfo } from "./chat-helpers";
import { openNewBoard, requireHarness } from "./helpers";

test.beforeAll(requireHarness);

/**
 * Runs that outlive Next processes and Convex outages (PLAN.md points 33 to 34c, 87).
 * Extra Next instances run with BOARD_RUN_TIME_SCALE=0.1: run lease 12 s,
 * renewals every 3 s, snapshots every 200 ms, delivery backoff 100 ms to 6 s.
 * Convex is made unreachable with SIGSTOP on the harness's local backend.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

type Board = { boardId: string; chatNodeId: string; textId: string };
let board: Board;
const extra: NextInstance[] = [];

async function scaledNext(env: Record<string, string> = {}) {
  const instance = await startNext({ BOARD_RUN_TIME_SCALE: "0.1", ...env });
  extra.push(instance);
  return instance;
}

test.afterAll(async () => {
  for (const instance of extra) await instance.kill().catch(() => {});
});

async function sendBody(client: NextInstance["client"], text: string, conversationId: string, runId = `run-e2e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  const meta = await client.get<{ revision: number; restoreEpoch: number }>(`/boards/${board.boardId}`);
  return { runId, boardId: board.boardId, boardRevision: meta.revision, restoreEpoch: meta.restoreEpoch, chatNodeId: board.chatNodeId, conversationId, text, engine: "claude", modelId: "sonnet", effort: "low", brandVoice: "none", allowTitleOnly: [] };
}

async function runInfo(client: NextInstance["client"], runId: string): Promise<RunInfo | null> {
  return client.get<RunInfo>(`/chat/runs/${runId}`).catch(() => null);
}

test("setup: one board with a text source and a chat node", async ({ page }) => {
  const url = await openNewBoard(page, `Resilienz ${Date.now() % 100000}`);
  const textId = await createTextNode(page, "Quelle", "Ein kurzer Text.");
  await page.getByRole("button", { name: "Verkleinern" }).click();
  await page.getByRole("button", { name: "Verkleinern" }).click();
  const chatNodeId = await createChatNode(page);
  await connectTo(page, textId, chatNodeId);
  board = { boardId: boardIdOf(url), chatNodeId, textId };
});

test("Next killed in the middle of the stream: the saved part stays and is closed as interrupted", async ({ page }) => {
  const b = await scaledNext();
  const body = await sendBody(b.client, "[[fake:stream=30000]] Erzähl lange", "conv-e2e-kill-0001");
  const started = await b.client.startChat(body);
  expect(started.status).toBe(200);
  const partial = await waitFor(async () => {
    const info = await runInfo(b.client, body.runId);
    return info && info.message.text.length >= 5 ? info : null;
  }, { label: "Teiltext gesichert" });
  await b.kill("SIGKILL");
  expect(journalFiles()).toContain(`${body.runId}.jsonl`);
  // The bridge ends the engine when the response closes; a fresh Next repairs the dead owner's journal at start.
  await waitFor(async () => (await bridgeRunState(body.runId)) === "finished", { label: "Engine beendet" });
  const c = await scaledNext();
  const closed = await waitFor(async () => {
    const info = await runInfo(c.client, body.runId);
    return info?.message.terminal ? info : null;
  }, { label: "Lauf abgeschlossen" });
  expect(closed.message.status).toBe("aborted");
  expect(closed.message.text.length).toBeGreaterThanOrEqual(partial.message.text.length);
  expect(journalFiles()).not.toContain(`${body.runId}.jsonl`);

  await page.goto(`/board/${board.boardId}`);
  const view = chat(page, board.chatNodeId);
  await view.conversations.filter({ hasText: "Erzähl lange" }).getByRole("button").first().click();
  await expect(view.lastAssistant).toHaveAttribute("data-status", "aborted");
  await expect(view.lastAssistant).toContainText("...");
  await expect(view.lastAssistant).toContainText("Unterbrochen.");
});

test("Convex away while the answer finishes, then Next restarted: the journal delivers the complete answer", async () => {
  const b = await scaledNext();
  const body = await sendBody(b.client, "[[fake:stream=3000]] Kurz", "conv-e2e-journal-01");
  const started = await b.client.startChat(body);
  expect(started.status).toBe(200);
  await waitFor(async () => (await runInfo(b.client, body.runId))?.message.seq, { label: "läuft" });
  await withConvexStopped(async () => {
    await waitFor(async () => (await bridgeRunState(body.runId)) === "finished", { label: "Antwort fertig" });
    // The final is in the journal (fsync), Convex did not confirm it.
    await waitFor(() => {
      const file = path.join(journalDir(), `${body.runId}.jsonl`);
      return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes('"kind":"final"');
    }, { label: "Abschluss im Journal" });
    await b.kill("SIGKILL");
  });
  const c = await scaledNext();
  const done = await waitFor(async () => {
    const info = await runInfo(c.client, body.runId);
    return info?.message.terminal ? info : null;
  }, { label: "nachgereicht" });
  expect(done.message.status).toBe("complete");
  expect(done.message.text).toContain("Fake-Antwort von claude");
  expect(journalFiles()).not.toContain(`${body.runId}.jsonl`);
});

test("long Convex outage with the engine still running: a new send gets 409 while the old run lives; its late end lands in its own message", async () => {
  const b = await scaledNext();
  const conversation = "conv-e2e-outage-01";
  const first = await sendBody(b.client, "[[fake:stream=35000]] Erster Lauf", conversation);
  expect((await b.client.startChat(first)).status).toBe(200);
  await waitFor(async () => (await runInfo(b.client, first.runId))?.message.seq, { label: "läuft" });
  // Longer than the scaled run lease (12 s): the claim lapses in Convex while the engine keeps going.
  await withConvexStopped(() => sleep(15_000));
  const second = await sendBody(b.client, "Zweiter Lauf", conversation);
  const refused = await b.client.startChat(second);
  expect(refused.status).toBe(409);
  expect(refused.json?.kind).toBe("run-active");
  expect(refused.json?.activeRunId).toBe(first.runId);
  const done = await waitFor(async () => {
    const info = await runInfo(b.client, first.runId);
    return info?.message.terminal ? info : null;
  }, { timeoutMs: 60_000, label: "erster Lauf fertig" });
  expect(done.message.status).toBe("complete");
  expect(done.message.text).toContain("Fake-Antwort von claude");
  expect(await runInfo(b.client, second.runId)).toBeNull();
  const again = await sendBody(b.client, "Zweiter Lauf, jetzt", conversation);
  expect((await b.client.startChat(again)).status).toBe(200);
  await waitFor(async () => (await runInfo(b.client, again.runId))?.message.terminal, { label: "zweiter Lauf fertig" });
});

test("journal ownership: doctor and a second Next leave a living owner's journal alone; foreign and unknown journals stay unchanged", async () => {
  const a = await scaledNext({ BOARD_RUN_TIME_SCALE: "1" });
  const body = await sendBody(a.client, "[[fake:stream=12000]] Besitz", "conv-e2e-owner-001");
  expect((await a.client.startChat(body)).status).toBe(200);
  const own = path.join(journalDir(), `${body.runId}.jsonl`);
  await waitFor(() => fs.existsSync(own), { label: "Journal angelegt" });

  const foreignDir = path.join(path.dirname(journalDir()), "local_andere-deployment");
  fs.mkdirSync(foreignDir, { recursive: true });
  const foreign = path.join(foreignDir, "run-fremd-0001.jsonl");
  fs.writeFileSync(foreign, `${JSON.stringify({ kind: "header", formatVersion: 1, deploymentId: "local:andere-deployment", ownerInstanceId: "next-dead00000000", runId: "run-fremd-0001", restoreEpoch: 1 })}\n`);
  const unknown = path.join(journalDir(), "run-unbekannt-01.jsonl");
  fs.writeFileSync(unknown, `${JSON.stringify({ kind: "header", formatVersion: 99, deploymentId: process.env.CONVEX_DEPLOYMENT, ownerInstanceId: "next-dead00000000", runId: "run-unbekannt-01" })}\n`);
  const snapshot = () => [foreign, unknown].map((file) => fs.readFileSync(file, "utf8"));
  const before = snapshot();

  const doctor = (args: string[]) => execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/board/doctor.mjs", "--teil", "laeufe", ...args], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] }).toString();
  const report = (() => {
    try {
      return doctor([]);
    } catch (error) {
      return String((error as { stdout?: string }).stdout ?? "");
    }
  })();
  expect(report).toContain(`Journal ${body.runId}`);
  expect(report).toMatch(/lebt/);
  expect(fs.existsSync(own)).toBe(true);
  try {
    doctor(["--repair"]);
  } catch {
    // a red line for the unknown journals is fine
  }
  await scaledNext();
  expect(fs.existsSync(own)).toBe(true);
  expect(snapshot()).toEqual(before);

  const done = await waitFor(async () => {
    const info = await runInfo(a.client, body.runId);
    return info?.message.terminal ? info : null;
  }, { timeoutMs: 60_000, label: "A schließt ab" });
  expect(done.message.status).toBe("complete");
  await waitFor(() => !fs.existsSync(own), { label: "Journal gelöscht" });
  expect(snapshot()).toEqual(before);
  fs.rmSync(foreignDir, { recursive: true, force: true });
  fs.rmSync(unknown, { force: true });
});

test("delivery loop: Convex away for a long time with a finished answer, back without a Next restart, the answer is saved complete", async () => {
  const b = await scaledNext();
  const body = await sendBody(b.client, "[[fake:stream=2000]] Zustellung", "conv-e2e-deliver-1");
  expect((await b.client.startChat(body)).status).toBe(200);
  await waitFor(async () => (await runInfo(b.client, body.runId))?.message.seq, { label: "läuft" });
  await withConvexStopped(async () => {
    await waitFor(async () => (await bridgeRunState(body.runId)) === "finished", { label: "Antwort fertig" });
    // "More than 5 minutes", scaled by 0.1: the backoff reaches its 6 s ceiling several times.
    await sleep(30_000);
  });
  const done = await waitFor(async () => {
    const info = await runInfo(b.client, body.runId);
    return info?.message.terminal ? info : null;
  }, { timeoutMs: 30_000, label: "zugestellt ohne Neustart" });
  expect(done.message.status).toBe("complete");
  expect(done.message.text).toContain("Fake-Antwort von claude");
  await waitFor(() => !journalFiles().includes(`${body.runId}.jsonl`), { label: "Journal gelöscht" });
});

// ---------------------------------------------------------------------------
// Dispatch (points 33, 33a): the same runId never starts a second engine run.

function convexAdmin() {
  return new ConvexHttpClient(process.env.BOARD_E2E_CONVEX_URL!);
}

async function startRunDirect(body: Awaited<ReturnType<typeof sendBody>>, dispatchLeaseMs: number) {
  return convexAdmin().mutation(anyApi.boardChat.startRun, {
    token: process.env.BOARD_ACCESS_TOKEN,
    opsVersion: 1,
    restoreEpoch: body.restoreEpoch,
    boardId: body.boardId,
    chatNodeId: body.chatNodeId,
    conversationId: body.conversationId,
    runId: body.runId,
    dispatcherId: "next-verstorben0",
    userText: body.text,
    engine: "claude",
    modelId: "sonnet",
    contextManifest: { youtube: [], texts: [] },
    dispatchLeaseMs,
  });
}

function promptsFor(marker: string): number {
  const dir = path.join(process.env.BOARD_E2E_ROOT!, "fake-stdin");
  return fs.readdirSync(dir).filter((name) => fs.readFileSync(path.join(dir, name), "utf8").includes(marker)).length;
}

test("dispatch: a lost startRun answer, retried with the same runId, starts exactly one run", async () => {
  const b = await scaledNext();
  const marker = `Einmal-${Date.now()}`;
  const body = await sendBody(b.client, `${marker} bitte`, "conv-e2e-dispatch-1");
  const first = await b.client.startChat(body);
  expect(first.status).toBe(200);
  const retry = await b.client.startChat(body);
  expect(retry.status).toBe(200);
  expect(await retry.stream).toContain('"follow":true');
  await waitFor(async () => (await runInfo(b.client, body.runId))?.message.terminal, { label: "fertig" });
  expect(promptsFor(marker)).toBe(1);
});

test("dispatch: Next died before the bridge call; the retry waits for the dispatch lease, then takes over and runs once", async () => {
  const b = await scaledNext();
  const marker = `Uebernahme-${Date.now()}`;
  const body = await sendBody(b.client, `${marker} bitte`, "conv-e2e-dispatch-2");
  expect((await startRunDirect(body, 3_000)).outcome).toBe("created");
  // The dead dispatcher's lease still runs: the retry only follows.
  const early = await b.client.startChat(body);
  expect(await early.stream).toContain('"follow":true');
  expect(promptsFor(marker)).toBe(0);
  await sleep(3_500);
  const late = await b.client.startChat(body);
  expect(late.status).toBe(200);
  expect(await late.stream).not.toContain('"follow":true');
  const done = await waitFor(async () => {
    const info = await runInfo(b.client, body.runId);
    return info?.message.terminal ? info : null;
  }, { label: "übernommen und fertig" });
  expect(done.message.status).toBe("complete");
  expect(promptsFor(marker)).toBe(1);
});

test("dispatch: Next died after the bridge call; the retry finds the run at the bridge and starts nothing new", async () => {
  const b = await scaledNext();
  const marker = `Bruecke-${Date.now()}`;
  const body = await sendBody(b.client, `[[fake:stream=4000]] ${marker}`, "conv-e2e-dispatch-3");
  expect((await startRunDirect(body, 1_000)).outcome).toBe("created");
  const bridgeRequest = { protocolVersion: 1, runId: body.runId, engine: "claude", modelId: "sonnet", effort: "low", knowledgeBase: [], brandVoice: null, messages: [{ role: "user", parts: [{ type: "text", text: body.text }] }], action: null, contextManifest: { youtube: [], texts: [] } };
  const direct = await fetch(`${process.env.BOARD_BRIDGE_URL}/v1/board/chat`, { method: "POST", headers: { "content-type": "application/json", "x-board-bridge-token": process.env.BOARD_BRIDGE_TOKEN! }, body: JSON.stringify(bridgeRequest) });
  expect(direct.status).toBe(200);
  await waitFor(async () => (await bridgeRunState(body.runId)) === "running", { label: "Bridge läuft" });
  await sleep(1_500);
  const retry = await b.client.startChat(body);
  expect(await retry.stream).toContain('"follow":true');
  await direct.text();
  expect(promptsFor(marker)).toBe(1);
});
