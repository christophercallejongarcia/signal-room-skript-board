/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { conversationTitle } from "./boardChat";

/** Chat runs in Convex (PLAN.md points 21, 29, 32 to 34, 87). */
const modules = import.meta.glob("./**/*.ts");
const token = "t".repeat(64);
const SESSION = "session-aaaa1111";
const BOARD = "long-firefly-Blk7C";
const CHAT = "chat-brave-otter-AAAAA";
const TEXT = "text-calm-river-BBBBB";
const VIDEO = "youtube-bold-fox-CCCCC";
const GROUP = "group-wise-owl-DDDDD";
const CHILD = "text-kind-lark-EEEEE";
const CONV = "conv-00000001";
const manifest = { youtube: [], texts: [] };

beforeEach(() => vi.stubEnv("BOARD_ACCESS_TOKEN", token));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

type T = ReturnType<typeof convexTest>;
let counter = 0;
const opId = () => `op-${(counter += 1).toString().padStart(6, "0")}`;

function shape(id: string, type: "textNode" | "youtubeNode" | "chatNode" | "groupNode", x: number, y: number, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const size = { textNode: [500, 300], youtubeNode: [290, 206], chatNode: [800, 700], groupNode: [600, 500] }[type];
  return { id, type, position: { x, y }, width: size[0], height: size[1], zIndex: type === "chatNode" ? 10 : type === "groupNode" ? -1 : 1, data: { title: "", ...data }, ...extra };
}

async function board(t: T) {
  await t.mutation(api.boards.create, { token, opsVersion: 1, id: BOARD, title: "Testboard" });
  const lease = await t.mutation(api.boardLease.acquire, { token, opsVersion: 1, boardId: BOARD, sessionId: SESSION, takeover: false });
  if (!lease.granted) throw new Error("lease");
  const apply = (ops: unknown[]) => t.mutation(api.boardOps.applyOps, { token, opsVersion: 1, restoreEpoch: 1, boardId: BOARD, sessionId: SESSION, leaseGeneration: lease.generation, ops });
  await apply([
    { opId: opId(), type: "node.create", node: shape(CHAT, "chatNode", 1000, 0, { engine: "claude", modelId: "sonnet" }) },
    { opId: opId(), type: "node.create", node: shape(TEXT, "textNode", 0, 0, { title: "Notiz" }), text: { blocks: "[]", markdown: "Meine Notiz" } },
    { opId: opId(), type: "node.create", node: shape(VIDEO, "youtubeNode", 0, 400, { title: "Video", videoId: "AAAAAAAAAAA", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" }) },
    { opId: opId(), type: "edge.create", source: VIDEO, target: CHAT },
    { opId: opId(), type: "edge.create", source: TEXT, target: CHAT },
  ]);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("youtubeSources", { videoId: "AAAAAAAAAAA", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA", title: "Video", transcriptStatus: "ready", activeVersion: { versionId: "v1", hash: "h", chars: 10, source: "auto-de" }, attempts: 1, updatedAt: now });
    await ctx.db.insert("youtubeTranscriptChunks", { videoId: "AAAAAAAAAAA", versionId: "v1", index: 0, text: "Hallo " });
    await ctx.db.insert("youtubeTranscriptChunks", { videoId: "AAAAAAAAAAA", versionId: "v1", index: 1, text: "Welt" });
  });
  const meta = await t.query(api.boardLoad.getBoard, { token, boardId: BOARD });
  return { apply, revision: meta.revision };
}

function start(t: T, runId: string, extra: Record<string, unknown> = {}) {
  return t.mutation(api.boardChat.startRun, {
    token,
    opsVersion: 1,
    restoreEpoch: 1,
    boardId: BOARD,
    chatNodeId: CHAT,
    conversationId: CONV,
    runId,
    dispatcherId: "next-a",
    userText: "Schreib mir drei Hooks über Kaffee am Morgen",
    engine: "claude",
    modelId: "sonnet",
    contextManifest: manifest,
    ...extra,
  });
}

const append = (t: T, runId: string, seq: number, text: string) => t.mutation(api.boardChat.appendRun, { token, opsVersion: 1, runId, seq, text, textHash: `h-${text}` });
const finish = (t: T, runId: string, seq: number, text: string, status: "complete" | "aborted" | "error" = "complete") => t.mutation(api.boardChat.finishRun, { token, opsVersion: 1, runId, seq, text, textHash: `h-${text}`, status });
const info = (t: T, runId: string) => t.query(api.boardChat.runInfo, { token, runId });

describe("startRun", () => {
  test("creates claim, user message and placeholder once; the same runId again creates nothing", async () => {
    const t = convexTest(schema, modules);
    await board(t);
    const first = await start(t, "run-00000001");
    expect(first).toMatchObject({ outcome: "created", generation: 1, conversationCreated: true });
    const again = await start(t, "run-00000001");
    expect(again).toMatchObject({ outcome: "exists", status: "streaming", terminal: false, claim: { runId: "run-00000001", state: "dispatching", dispatcherId: "next-a", generation: 1 } });
    const { messages } = await t.query(api.boardChat.listMessages, { token, conversationId: CONV });
    expect(messages.map((m) => [m.id, m.role, m.status])).toEqual([
      ["run-00000001-u", "user", "complete"],
      ["run-00000001-a", "assistant", "streaming"],
    ]);
    const [conversation] = await t.query(api.boardChat.listConversations, { token, boardId: BOARD, chatNodeId: CHAT });
    expect(conversation.title).toBe("Schreib mir drei Hooks über Kaffee");
  });

  test("a second run while the first holds the claim gets 409; a lapsed claim needs the bridge check first", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await board(t);
    await start(t, "run-00000001");
    await expect(start(t, "run-00000002")).rejects.toThrow(/Vorheriger Lauf läuft noch/);
    vi.advanceTimersByTime(31_000);
    await expect(start(t, "run-00000002")).rejects.toThrow(/erst geprüft/);
    const taken = await start(t, "run-00000002", { takeoverRunId: "run-00000001" });
    expect(taken).toMatchObject({ outcome: "created", generation: 2, conversationCreated: false });
    // The old run's late finish lands in its own message and never touches the new claim.
    expect(await finish(t, "run-00000001", 3, "spät, aber vollständig")).toMatchObject({ status: "applied" });
    expect((await info(t, "run-00000001"))?.message).toMatchObject({ text: "spät, aber vollständig", status: "complete", terminal: true });
    expect((await info(t, "run-00000002"))?.activeRun).toMatchObject({ runId: "run-00000002", generation: 2 });
  });

  test("draining refuses new runs but lets running ones finish; restoring refuses everything", async () => {
    const t = convexTest(schema, modules);
    await board(t);
    await start(t, "run-00000001");
    await t.mutation(internal.boardAdmin.setMode, { mode: "draining" });
    await expect(start(t, "run-00000009")).rejects.toThrow(/Drain/);
    expect(await append(t, "run-00000001", 1, "Teil")).toEqual({ status: "applied" });
    await t.mutation(internal.boardAdmin.setMode, { mode: "restoring" });
    await expect(finish(t, "run-00000001", 2, "Teil zwei")).rejects.toThrow(/wiederhergestellt/);
  });

  test("messages over 200 KB and foreign chat nodes are refused", async () => {
    const t = convexTest(schema, modules);
    await board(t);
    await expect(start(t, "run-00000001", { userText: "ä".repeat(110_000) })).rejects.toThrow(/zu lang/);
    await expect(start(t, "run-00000001", { chatNodeId: TEXT })).rejects.toThrow(/Chat-Node/);
  });
});

describe("appendRun and finishRun", () => {
  test("higher seq applies, same seq and hash is a duplicate, lower seq is refused, swapped writes keep the newer text", async () => {
    const t = convexTest(schema, modules);
    await board(t);
    await start(t, "run-00000001");
    expect(await append(t, "run-00000001", 2, "Hallo Welt")).toEqual({ status: "applied" });
    expect(await append(t, "run-00000001", 2, "Hallo Welt")).toEqual({ status: "duplicate" });
    expect(await append(t, "run-00000001", 1, "Hallo")).toEqual({ status: "stale" });
    expect((await info(t, "run-00000001"))?.message.text).toBe("Hallo Welt");
  });

  test("the first terminal write wins: stop against end, and nothing is written afterwards", async () => {
    const t = convexTest(schema, modules);
    await board(t);
    await start(t, "run-00000001");
    await append(t, "run-00000001", 1, "Teil");
    expect(await finish(t, "run-00000001", 1, "Teil", "aborted")).toEqual({ status: "applied", finalStatus: "aborted" });
    expect(await finish(t, "run-00000001", 5, "Teil und Ende", "complete")).toEqual({ status: "terminal", finalStatus: "aborted" });
    expect(await append(t, "run-00000001", 9, "zu spät")).toEqual({ status: "terminal" });
    const run = await info(t, "run-00000001");
    expect(run?.message).toMatchObject({ text: "Teil", status: "aborted", terminal: true });
    expect(run?.activeRun).toBeNull();
  });

  test("a late finish with an older seq keeps the newer snapshot", async () => {
    const t = convexTest(schema, modules);
    await board(t);
    await start(t, "run-00000001");
    await append(t, "run-00000001", 4, "vier Teile");
    await finish(t, "run-00000001", 2, "zwei", "complete");
    expect((await info(t, "run-00000001"))?.message).toMatchObject({ text: "vier Teile", status: "complete", seq: 4 });
  });

  test("an orphaned run stays non-terminal after its claim lapses; only an explicit abort ends it", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await board(t);
    await start(t, "run-00000001");
    await append(t, "run-00000001", 1, "angefangen");
    vi.advanceTimersByTime(10 * 60_000);
    expect((await info(t, "run-00000001"))?.message).toMatchObject({ status: "streaming", terminal: false });
    await finish(t, "run-00000001", 1, "angefangen", "aborted");
    expect((await info(t, "run-00000001"))?.message.status).toBe("aborted");
  });

  test("appendRun extends the run lease; renew and markRunning need runId, dispatcher and generation", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await board(t);
    const created = await start(t, "run-00000001");
    if (created.outcome !== "created") throw new Error();
    const claim = { token, opsVersion: 1, runId: "run-00000001", dispatcherId: "next-a", generation: created.generation };
    await expect(t.mutation(api.boardChat.markRunning, { ...claim, dispatcherId: "next-b" })).rejects.toThrow(/anderen Prozess/);
    await expect(t.mutation(api.boardChat.renewRun, { ...claim, generation: 7 })).rejects.toThrow(/anderen Prozess/);
    const running = await t.mutation(api.boardChat.markRunning, claim);
    vi.advanceTimersByTime(100_000);
    await append(t, "run-00000001", 1, "Text");
    const after = (await info(t, "run-00000001"))?.activeRun;
    expect(after?.state).toBe("running");
    expect(after!.expiresAt).toBeGreaterThan(running.expiresAt);
    const renewed = await t.mutation(api.boardChat.renewRun, claim);
    expect(renewed.expiresAt).toBeGreaterThanOrEqual(after!.expiresAt);
  });

  test("takeDispatch only for a lapsed dispatching claim, with a new generation", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await board(t);
    await start(t, "run-00000001");
    await expect(t.mutation(api.boardChat.takeDispatch, { token, opsVersion: 1, runId: "run-00000001", dispatcherId: "next-b" })).rejects.toThrow(/nicht übernehmbar/);
    vi.advanceTimersByTime(31_000);
    const taken = await t.mutation(api.boardChat.takeDispatch, { token, opsVersion: 1, runId: "run-00000001", dispatcherId: "next-b" });
    expect(taken.generation).toBe(2);
    await expect(t.mutation(api.boardChat.markRunning, { token, opsVersion: 1, runId: "run-00000001", dispatcherId: "next-a", generation: 1 })).rejects.toThrow(/anderen Prozess/);
    await t.mutation(api.boardChat.markRunning, { token, opsVersion: 1, runId: "run-00000001", dispatcherId: "next-b", generation: 2 });
  });
});

describe("context", () => {
  test("metadata first, then content at the confirmed revision only; groups bring their children", async () => {
    const t = convexTest(schema, modules);
    const { apply, revision } = await board(t);
    const meta = await t.query(api.boardChat.chatSources, { token, boardId: BOARD, chatNodeId: CHAT });
    expect(meta.revision).toBe(revision);
    expect(meta.nodes.map((node) => node.id).sort()).toEqual([TEXT, VIDEO].sort());
    expect(meta.nodes.find((node) => node.id === TEXT)?.textBytes).toBe(11);
    expect(meta.youtube).toEqual([{ videoId: "AAAAAAAAAAA", status: "ready", chars: 10, versionId: "v1", title: "Video" }]);

    const context = await t.query(api.boardChat.chatContext, { token, boardId: BOARD, chatNodeId: CHAT, boardRevision: revision, conversationId: CONV });
    expect(context.texts).toEqual([{ nodeId: TEXT, markdown: "Meine Notiz" }]);
    expect(context.transcripts).toEqual([{ videoId: "AAAAAAAAAAA", status: "ready", versionId: "v1", text: "Hallo Welt", title: "Video" }]);

    await apply([
      { opId: opId(), type: "node.create", node: shape(GROUP, "groupNode", 0, 800, { title: "Playbooks" }) },
      { opId: opId(), type: "node.create", node: shape(CHILD, "textNode", 40, 80, { title: "Kind" }, { parentId: GROUP }), text: { blocks: "[]", markdown: "im Ordner" } },
      { opId: opId(), type: "edge.create", source: GROUP, target: CHAT },
    ]);
    await expect(t.query(api.boardChat.chatContext, { token, boardId: BOARD, chatNodeId: CHAT, boardRevision: revision, conversationId: CONV })).rejects.toThrow(/geändert/);
    const fresh = await t.query(api.boardChat.chatSources, { token, boardId: BOARD, chatNodeId: CHAT });
    expect(fresh.nodes.map((node) => node.id)).toContain(CHILD);
    const next = await t.query(api.boardChat.chatContext, { token, boardId: BOARD, chatNodeId: CHAT, boardRevision: fresh.revision, conversationId: CONV });
    expect(next.texts.find((text) => text.nodeId === CHILD)?.markdown).toBe("im Ordner");
  });

  test("history holds user turns and complete answers, oldest first, limited to the last N turns", async () => {
    const t = convexTest(schema, modules);
    const { revision } = await board(t);
    for (let i = 1; i <= 3; i += 1) {
      const runId = `run-0000000${i}`;
      await start(t, runId, { userText: `Frage ${i}` });
      await finish(t, runId, 1, i === 2 ? "" : `Antwort ${i}`, i === 2 ? "error" : "complete");
    }
    const all = await t.query(api.boardChat.chatContext, { token, boardId: BOARD, chatNodeId: CHAT, boardRevision: revision, conversationId: CONV });
    expect(all.history.map((turn) => `${turn.role}:${turn.text}`)).toEqual(["user:Frage 1", "assistant:Antwort 1", "user:Frage 2", "user:Frage 3", "assistant:Antwort 3"]);
    const last = await t.query(api.boardChat.chatContext, { token, boardId: BOARD, chatNodeId: CHAT, boardRevision: revision, conversationId: CONV, historyTurns: 1 });
    expect(last.history.map((turn) => turn.text)).toEqual(["Frage 3", "Antwort 3"]);
  });
});

test("conversations: title from the first words with mentions as titles; rename; delete refused while a run holds it", async () => {
  expect(conversationTitle('Nutze <poppy_reference_node nodeId="x" title="Hook-Formel &quot;K&quot;" type="textNode" /> und das Video für drei Hooks')).toBe('Nutze Hook-Formel "K" und das Video');
  expect(conversationTitle("   ")).toBe("Neue Unterhaltung");
  const t = convexTest(schema, modules);
  await board(t);
  await start(t, "run-00000001");
  await t.mutation(api.boardChat.renameConversation, { token, opsVersion: 1, restoreEpoch: 1, boardId: BOARD, conversationId: CONV, title: "Kaffee-Hooks" });
  await expect(t.mutation(api.boardChat.deleteConversation, { token, opsVersion: 1, restoreEpoch: 1, boardId: BOARD, conversationId: CONV })).rejects.toThrow(/stoppen/);
  await finish(t, "run-00000001", 1, "fertig");
  await t.mutation(api.boardChat.deleteConversation, { token, opsVersion: 1, restoreEpoch: 1, boardId: BOARD, conversationId: CONV });
  expect(await t.query(api.boardChat.listConversations, { token, boardId: BOARD, chatNodeId: CHAT })).toEqual([]);
});
