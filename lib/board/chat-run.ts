import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { logEvent } from "./eventlog.mjs";
import { holdInstanceLock, RunJournal, repairDeadJournals, type JournalFinal } from "./run-journal.mjs";
import { buildContext, RUN_ID, staleMentions, type BoardChatRequestV1, type ContextManifest, type ContextNode } from "./context.ts";
import { checkBudget, CODEX_CONFIG_MODEL, isEffort, isEngineId, type Effort, type EngineId } from "./models.ts";
import { renderedBytes, renderPrompt, SYSTEM_TEXT } from "./prompt.ts";
import { BoardApiError, boardConvex, bridgeFetch, webInstance } from "./server.ts";
import { OPS_VERSION, PROTOCOL_VERSION } from "./versions.ts";

/**
 * Sending a chat message (PLAN.md points 32 to 34c, 81 to 85): metadata and
 * budget first, then the content at the confirmed revision, then the claim in
 * Convex, then the bridge. The stream is pumped by this process independently
 * of the browser: every snapshot goes to the run journal before Convex, and a
 * final answer that Convex did not confirm is delivered by a background loop.
 */

export type SendBody = {
  runId: string;
  boardId: string;
  boardRevision: number;
  restoreEpoch: number;
  chatNodeId: string;
  conversationId: string;
  text: string;
  engine: EngineId;
  modelId: string;
  effort: Effort;
  brandVoice: "none" | "chris";
  promptId?: string;
  allowTitleOnly: string[];
  historyTurns?: number;
};

const CONVERSATION_ID = /^[A-Za-z0-9_-]{8,100}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseSendBody(body: Record<string, unknown>): SendBody {
  const bad = (message: string): never => {
    throw new BoardApiError(400, "invalid", message);
  };
  const runId = typeof body.runId === "string" && RUN_ID.test(body.runId) ? body.runId : bad("Ungültige runId.");
  const boardId = typeof body.boardId === "string" ? body.boardId : bad("boardId fehlt.");
  const chatNodeId = typeof body.chatNodeId === "string" ? body.chatNodeId : bad("chatNodeId fehlt.");
  const conversationId = typeof body.conversationId === "string" && CONVERSATION_ID.test(body.conversationId) ? body.conversationId : bad("Ungültige Unterhaltung.");
  const text = typeof body.text === "string" && body.text.trim() ? body.text : bad("Leere Nachricht.");
  const engine = isEngineId(body.engine) ? body.engine : bad("Unbekannte Engine.");
  const modelId = typeof body.modelId === "string" && /^[A-Za-z0-9._/:-]{1,100}$/.test(body.modelId) ? body.modelId : bad("Ungültiges Modell.");
  const effort = isEffort(body.effort) ? body.effort : "medium";
  const boardRevision = typeof body.boardRevision === "number" ? body.boardRevision : bad("boardRevision fehlt.");
  const restoreEpoch = typeof body.restoreEpoch === "number" ? body.restoreEpoch : 1;
  const allowTitleOnly = Array.isArray(body.allowTitleOnly) ? body.allowTitleOnly.filter((id): id is string => typeof id === "string" && VIDEO_ID.test(id)) : [];
  const historyTurns = typeof body.historyTurns === "number" && body.historyTurns >= 0 ? Math.floor(body.historyTurns) : undefined;
  const promptId = typeof body.promptId === "string" && body.promptId.length <= 200 ? body.promptId : undefined;
  return { runId, boardId, boardRevision, restoreEpoch, chatNodeId, conversationId, text, engine, modelId: engine === "codex" ? CODEX_CONFIG_MODEL : modelId, effort, brandVoice: body.brandVoice === "chris" ? "chris" : "none", promptId, allowTitleOnly, historyTurns };
}

// ---------------------------------------------------------------------------
// Timing and background state

/** Lease and snapshot timing of point 33 and 34, scalable for tests (BOARD_RUN_TIME_SCALE). */
export function runTiming(env: Record<string, string | undefined> = process.env) {
  const scale = Number(env.BOARD_RUN_TIME_SCALE || 1) || 1;
  const ms = (value: number, min = 50) => Math.max(min, Math.round(value * scale));
  return {
    renewMs: ms(30_000),
    runLeaseMs: ms(120_000, 500),
    dispatchLeaseMs: ms(30_000, 500),
    snapshotMs: ms(2_000),
    snapshotBytes: 4 * 1024,
    deliverMinMs: ms(1_000),
    deliverMaxMs: ms(60_000),
    repairEveryMs: ms(60_000),
    convexTimeoutMs: Math.max(2_000, Math.round(15_000 * Math.min(scale, 1))),
  };
}

export function deploymentId(): string {
  const env: Record<string, string | undefined> = process.env;
  return env.CONVEX_DEPLOYMENT ?? env.NEXT_PUBLIC_CONVEX_URL ?? "unbekannt";
}

type Pending = { runId: string; journal: RunJournal; final: JournalFinal; attempts: number; nextAt: number; lastError?: string; stuck?: boolean };

type Background = {
  instanceId: string;
  pending: Map<string, Pending>;
  running: Map<string, { abort(): void }>;
  timer: ReturnType<typeof setInterval> | null;
  lastRepair: number;
};

const globalForChat = globalThis as typeof globalThis & { __boardChatBackground?: Background };

/**
 * This process's run machinery: the Next instance lock (point 34a), the
 * delivery loop for its own unconfirmed finals (34c) and the repair of dead
 * owners' journals at start and every minute (34b).
 */
export function chatBackground(): Background {
  if (globalForChat.__boardChatBackground) return globalForChat.__boardChatBackground;
  const { instanceId } = webInstance();
  holdInstanceLock(instanceId);
  const background: Background = { instanceId, pending: new Map(), running: new Map(), timer: null, lastRepair: 0 };
  globalForChat.__boardChatBackground = background;
  const timing = runTiming();
  background.timer = setInterval(() => void tick(background), Math.min(timing.deliverMinMs, 1_000));
  background.timer.unref?.();
  void repair(background);
  return background;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BoardApiError(504, "unavailable", `${label}: Convex antwortet nicht.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** finishRun for a journal final; true once Convex holds a terminal state for the run. */
export async function deliverFinal(runId: string, final: JournalFinal): Promise<boolean> {
  const timing = runTiming();
  const result = await withTimeout(
    boardConvex().mutation<{ status: "applied" | "terminal" }>("boardChat:finishRun", {
      opsVersion: OPS_VERSION,
      runId,
      seq: final.seq,
      text: final.text,
      textHash: final.hash,
      status: final.status,
      ...(final.reasoning ? { reasoning: final.reasoning } : {}),
      ...(final.usage ? { usage: final.usage } : {}),
      ...(final.error ? { error: final.error } : {}),
    }),
    timing.convexTimeoutMs,
    "finishRun",
  );
  return result.status === "applied" || result.status === "terminal";
}

async function tick(background: Background) {
  const timing = runTiming();
  const now = Date.now();
  for (const entry of background.pending.values()) {
    if (entry.stuck || entry.nextAt > now) continue;
    entry.nextAt = Number.MAX_SAFE_INTEGER;
    try {
      if (await deliverFinal(entry.runId, entry.final)) {
        entry.journal.remove();
        background.pending.delete(entry.runId);
        logEvent({ instanceId: background.instanceId, layer: "web", runId: entry.runId, phase: "journal-delivered", count: entry.attempts });
        continue;
      }
    } catch (error) {
      const kind = error instanceof BoardApiError ? error.kind : "error";
      entry.lastError = error instanceof Error ? error.message : String(error);
      // A run the deployment no longer knows, or one from before a restore, never becomes deliverable: keep the file for the status page.
      if (kind === "not-found" || kind === "epoch") entry.stuck = true;
    }
    entry.attempts += 1;
    entry.nextAt = Date.now() + Math.min(timing.deliverMaxMs, timing.deliverMinMs * 2 ** Math.min(entry.attempts - 1, 10));
  }
  if (now - background.lastRepair > timing.repairEveryMs) await repair(background);
}

async function bridgeRunState(runId: string): Promise<"unknown" | "running" | "finished"> {
  const response = await bridgeFetch(`/v1/board/runs/${encodeURIComponent(runId)}`, { timeoutMs: 5_000 });
  if (!response.ok) throw new Error(`Bridge antwortet mit ${response.status}.`);
  const data = (await response.json()) as { state: "unknown" | "running" | "finished" };
  return data.state;
}

async function repair(background: Background) {
  background.lastRepair = Date.now();
  try {
    const results = await repairDeadJournals({ deploymentId: deploymentId(), selfInstanceId: background.instanceId, deliver: deliverFinal, bridgeState: bridgeRunState });
    for (const result of results) if (result.action !== "owner-alive") logEvent({ instanceId: background.instanceId, layer: "web", runId: result.runId, phase: "journal-repair", code: result.action });
  } catch {
    // next round
  }
}

// ---------------------------------------------------------------------------
// Sending

type SourceMeta = ContextNode & { textBytes?: number };
type ChatSources = { revision: number; brandVoiceText: string; nodes: SourceMeta[]; edges: { source: string; target: string; createdAt: number }[]; youtube: { videoId: string; status: string; chars?: number; versionId?: string; title?: string }[] };
type ChatContext = ChatSources & {
  texts: { nodeId: string; markdown: string; provenance?: ContextManifest }[];
  transcripts: { videoId: string; status: string; versionId?: string; text?: string; title?: string }[];
  history: { role: "user" | "assistant"; text: string }[];
};

const utf8 = (text: string) => Buffer.byteLength(text, "utf8");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Chris' voice from YT-OS `identity.md`, section "Stimme": the default of brand voice "Chris". */
export function defaultBrandVoice(): string {
  const root = process.env.YTOS_ROOT?.trim() || "~/dev/YT-OS";
  try {
    const text = fs.readFileSync(path.join(root, "identity.md"), "utf8");
    const match = text.match(/^## Stimme\s*\n([\s\S]*?)(?=^## |\Z)/m);
    return (match?.[1] ?? "").trim().slice(0, 20_000);
  } catch {
    return "";
  }
}

export function brandVoiceFor(choice: "none" | "chris", boardText: string): string | null {
  if (choice === "none") return null;
  return boardText.trim() || defaultBrandVoice() || null;
}

function budgetError(engine: EngineId, modelId: string, estimate: { estimatedTokens: number; budgetTokens: number }, sources: { nodeId: string; title: string; type: string; bytes: number }[], history: { turns: number; bytes: number }) {
  return new BoardApiError(413, "budget", `Kontext zu groß für dieses Modell: geschätzt ${estimate.estimatedTokens.toLocaleString("de-DE")} von ${estimate.budgetTokens.toLocaleString("de-DE")} Tokens.`, {
    engine,
    modelId,
    estimatedTokens: estimate.estimatedTokens,
    budgetTokens: estimate.budgetTokens,
    sources: [...sources].sort((a, b) => b.bytes - a.bytes).slice(0, 50),
    historyTurns: history.turns,
    historyBytes: history.bytes,
  });
}

/** Metadata-only budget check (point 32, step one): text bytes and transcript characters as a lower bound. */
export function precheckBudget(input: SendBody, meta: ChatSources, brandVoice: string | null) {
  const readyChars = new Map(meta.youtube.filter((entry) => entry.status === "ready").map((entry) => [entry.videoId, entry.chars ?? 0]));
  let bytes = utf8(SYSTEM_TEXT) + utf8(input.text) + (brandVoice ? utf8(brandVoice) : 0);
  const sources: { nodeId: string; title: string; type: string; bytes: number }[] = [];
  for (const node of meta.nodes) {
    let size = 0;
    if (node.type === "textNode") size = node.textBytes ?? 0;
    else if (node.type === "youtubeNode" && node.videoId) size = readyChars.get(node.videoId) ?? 0;
    else continue;
    bytes += size;
    sources.push({ nodeId: node.id, title: node.title || (node.type === "textNode" ? "Text" : "YouTube-Video"), type: node.type, bytes: size });
  }
  return { check: checkBudget(input.engine, input.modelId, bytes), sources };
}

export type PreparedRun = { request: BoardChatRequestV1; contextManifest: ContextManifest };

/** Steps one to three of point 32 plus the source gate (72), mentions (84) and the exact budget (40 to 42). */
export async function prepareRun(input: SendBody): Promise<PreparedRun> {
  const convex = boardConvex();
  const meta = await convex.query<ChatSources>("boardChat:chatSources", { boardId: input.boardId, chatNodeId: input.chatNodeId });
  if (meta.revision !== input.boardRevision) throw new BoardApiError(409, "revision", "Board hat sich geändert, bitte erneut senden.", { revision: meta.revision });
  const brandVoice = brandVoiceFor(input.brandVoice, meta.brandVoiceText);
  const pre = precheckBudget(input, meta, brandVoice);
  if (!pre.check.ok) throw budgetError(input.engine, input.modelId, pre.check, pre.sources, { turns: 0, bytes: 0 });
  const notReady = meta.youtube.filter((entry) => entry.status !== "ready" && !input.allowTitleOnly.includes(entry.videoId));
  if (notReady.length > 0) {
    throw new BoardApiError(409, "sources-not-ready", "Nicht alle verbundenen Quellen sind fertig.", { sources: notReady.map((entry) => ({ videoId: entry.videoId, status: entry.status, title: entry.title ?? meta.nodes.find((node) => node.videoId === entry.videoId)?.title ?? entry.videoId })) });
  }

  const context = await convex.query<ChatContext>("boardChat:chatContext", {
    boardId: input.boardId,
    chatNodeId: input.chatNodeId,
    boardRevision: input.boardRevision,
    conversationId: input.conversationId,
    ...(input.historyTurns !== undefined ? { historyTurns: input.historyTurns } : {}),
  });
  const built = buildContext({
    chatNodeId: input.chatNodeId,
    nodes: context.nodes,
    edges: context.edges,
    texts: Object.fromEntries(context.texts.map((text) => [text.nodeId, { markdown: text.markdown, provenance: text.provenance ?? null }])),
    transcripts: Object.fromEntries(context.transcripts.map((entry) => [entry.videoId, entry])),
    titleOnly: input.allowTitleOnly,
    hashText: sha,
  });
  if (built.blocked.length > 0) throw new BoardApiError(409, "sources-not-ready", "Nicht alle verbundenen Quellen sind fertig.", { sources: built.blocked });
  const stale = staleMentions(input.text, context.nodes.map((node) => node.id));
  if (stale.length > 0) throw new BoardApiError(409, "stale-mention", "Die Nachricht erwähnt eine Quelle, die nicht mehr verbunden ist.", { nodeIds: stale });

  const request: BoardChatRequestV1 = {
    protocolVersion: PROTOCOL_VERSION,
    runId: input.runId,
    engine: input.engine,
    modelId: input.modelId,
    effort: input.effort,
    knowledgeBase: built.knowledgeBase,
    brandVoice,
    messages: [...context.history.map((turn) => ({ role: turn.role, parts: [{ type: "text" as const, text: turn.text }] })), { role: "user", parts: [{ type: "text", text: input.text }] }],
    action: input.promptId ?? null,
    contextManifest: built.contextManifest,
  };
  const exact = checkBudget(input.engine, input.modelId, renderedBytes(renderPrompt(request)));
  if (!exact.ok) {
    const historyBytes = context.history.reduce((sum, turn) => sum + utf8(turn.text), 0);
    throw budgetError(input.engine, input.modelId, exact, built.sources, { turns: Math.ceil(context.history.length / 2), bytes: historyBytes });
  }
  return { request, contextManifest: built.contextManifest };
}

type ActiveRun = { runId: string; state: "dispatching" | "running"; dispatcherId: string; generation: number; expiresAt: number } | null;
type StartResult = { outcome: "created"; generation: number; expiresAt: number; conversationCreated: boolean } | { outcome: "exists"; claim: ActiveRun; status: string; terminal: boolean };

export type StartDecision = { action: "dispatch"; generation: number; conversationCreated: boolean } | { action: "follow"; reason: string };

/**
 * Point 33 to 33b: start the run, or on a retry of the same runId decide
 * between taking over a quiet dispatch and following the existing run.
 */
export async function claimRun(input: SendBody, contextManifest: ContextManifest, dispatcherId: string): Promise<StartDecision> {
  const convex = boardConvex();
  const timing = runTiming();
  const args = {
    opsVersion: OPS_VERSION,
    restoreEpoch: input.restoreEpoch,
    boardId: input.boardId,
    chatNodeId: input.chatNodeId,
    conversationId: input.conversationId,
    runId: input.runId,
    dispatcherId,
    userText: input.text,
    engine: input.engine,
    modelId: input.modelId,
    effort: input.effort,
    ...(input.promptId ? { promptId: input.promptId } : {}),
    contextManifest,
    dispatchLeaseMs: timing.dispatchLeaseMs,
  };
  let start: StartResult;
  try {
    start = await convex.mutation<StartResult>("boardChat:startRun", args);
  } catch (error) {
    if (error instanceof BoardApiError && error.kind === "conflict" && error.details.reason === "run-active") {
      throw new BoardApiError(409, "run-active", "Vorheriger Lauf läuft noch.", { activeRunId: error.details.activeRunId });
    }
    if (!(error instanceof BoardApiError) || error.kind !== "conflict" || error.details.reason !== "claim-lapsed") throw error;
    // 33b: the old claim lapsed. Only if the bridge no longer runs it may this run take over.
    const oldRunId = String(error.details.activeRunId);
    const state = await bridgeRunState(oldRunId).catch(() => "running" as const);
    if (state === "running") throw new BoardApiError(409, "run-active", "Vorheriger Lauf läuft noch.", { activeRunId: oldRunId });
    start = await convex.mutation<StartResult>("boardChat:startRun", { ...args, takeoverRunId: oldRunId });
  }
  if (start.outcome === "created") return { action: "dispatch", generation: start.generation, conversationCreated: start.conversationCreated };
  if (start.terminal) return { action: "follow", reason: "done" };
  const claim = start.claim;
  if (claim && claim.state === "dispatching" && claim.expiresAt < Date.now()) {
    // 33a: nobody confirmed the start. Unknown to the bridge: take over and start; known: follow.
    const state = await bridgeRunState(input.runId);
    if (state === "unknown") {
      const taken = await convex.mutation<{ generation: number }>("boardChat:takeDispatch", { opsVersion: OPS_VERSION, runId: input.runId, dispatcherId, dispatchLeaseMs: timing.dispatchLeaseMs });
      return { action: "dispatch", generation: taken.generation, conversationCreated: false };
    }
  }
  return { action: "follow", reason: "exists" };
}

type BridgeEvent =
  | { type: "start"; runId: string; engine: string; modelId: string }
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "finish"; usage?: { inputTokens: number; outputTokens: number } }
  | { type: "error"; code: string; message: string }
  | { type: "ping" };

type ClientSink = { write(chunk: UIMessageChunk): void; close(): void };

function clientSink(writer: WritableStreamDefaultWriter<UIMessageChunk>): ClientSink {
  let open = true;
  return {
    write(chunk) {
      if (!open) return;
      writer.write(chunk).catch(() => {
        // The browser went away; the run goes on without it.
        open = false;
      });
    },
    close() {
      if (!open) return;
      open = false;
      writer.close().catch(() => {});
    },
  };
}

/**
 * Pump the bridge stream into Convex (snapshots and final) and to the browser.
 * Runs to the end even if the browser disconnects; only the stop route or the
 * engine ends a run.
 */
async function pump({ input, generation, dispatcherId, response, journal, sink, background }: { input: SendBody; generation: number; dispatcherId: string; response: Response; journal: RunJournal; sink: ClientSink; background: Background }) {
  const convex = boardConvex();
  const timing = runTiming();
  const claim = { opsVersion: OPS_VERSION, runId: input.runId, dispatcherId, generation, runLeaseMs: timing.runLeaseMs };
  let text = "";
  let reasoning = "";
  let seq = 0;
  let lastSnapshotAt = Date.now();
  let lastSnapshotLength = 0;
  let status: JournalFinal["status"] | null = null;
  let usage: JournalFinal["usage"];
  let error: JournalFinal["error"];
  let textOpen = false;
  let reasoningOpen = false;
  const textId = `${input.runId}-text`;
  const reasoningId = `${input.runId}-reasoning`;
  const quiet = (promise: Promise<unknown>) => void withTimeout(promise, timing.convexTimeoutMs, "Convex").catch(() => {});

  const renew = setInterval(() => quiet(convex.mutation("boardChat:renewRun", claim)), timing.renewMs);
  const snapshot = () => {
    seq += 1;
    const hash = sha(text);
    lastSnapshotAt = Date.now();
    lastSnapshotLength = text.length;
    try {
      journal.snapshot({ seq, hash, text, ...(reasoning ? { reasoning } : {}) });
    } catch {
      // the Convex write still goes out
    }
    quiet(convex.mutation("boardChat:appendRun", { opsVersion: OPS_VERSION, runId: input.runId, seq, text, textHash: hash, ...(reasoning ? { reasoning } : {}), runLeaseMs: timing.runLeaseMs }));
  };

  try {
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += value;
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: BridgeEvent;
        try {
          event = JSON.parse(line) as BridgeEvent;
        } catch {
          continue;
        }
        if (event.type === "start") quiet(convex.mutation("boardChat:markRunning", claim));
        else if (event.type === "text-delta") {
          if (reasoningOpen) {
            sink.write({ type: "reasoning-end", id: reasoningId });
            reasoningOpen = false;
          }
          if (!textOpen) {
            sink.write({ type: "text-start", id: textId });
            textOpen = true;
          }
          text += event.text;
          sink.write({ type: "text-delta", id: textId, delta: event.text });
        } else if (event.type === "reasoning-delta") {
          reasoning += event.text;
          if (!textOpen) {
            if (!reasoningOpen) {
              sink.write({ type: "reasoning-start", id: reasoningId });
              reasoningOpen = true;
            }
            sink.write({ type: "reasoning-delta", id: reasoningId, delta: event.text });
          }
        } else if (event.type === "finish") {
          status = "complete";
          usage = event.usage;
        } else if (event.type === "error") {
          status = event.code === "aborted" ? "aborted" : "error";
          error = { code: event.code, message: event.message };
        }
        if (Date.now() - lastSnapshotAt >= timing.snapshotMs || text.length - lastSnapshotLength >= timing.snapshotBytes) snapshot();
      }
    }
  } catch (streamError) {
    if (!status) {
      status = "error";
      error = { code: "bridge-lost", message: `Die Verbindung zur Bridge ist abgebrochen (${streamError instanceof Error ? streamError.message : "unbekannt"}).` };
    }
  } finally {
    clearInterval(renew);
  }
  if (!status) {
    status = "error";
    error = { code: "bridge-lost", message: "Die Bridge hat den Lauf ohne Abschluss beendet." };
  }
  const final: JournalFinal = { seq: seq + 1, hash: sha(text), text, status, ...(reasoning ? { reasoning } : {}), ...(usage ? { usage } : {}), ...(error ? { error } : {}) };
  await finalize({ runId: input.runId, final, journal, background });

  if (reasoningOpen) sink.write({ type: "reasoning-end", id: reasoningId });
  if (textOpen) sink.write({ type: "text-end", id: textId });
  if (status === "complete") sink.write({ type: "finish", finishReason: "stop" });
  else if (status === "aborted") sink.write({ type: "abort", reason: "Abgebrochen." });
  else sink.write({ type: "error", errorText: error?.message ?? "Die Engine hat mit einem Fehler geantwortet." });
  sink.close();
  logEvent({ instanceId: background.instanceId, layer: "web", runId: input.runId, engine: input.engine, phase: "chat", code: status });
}

/** Journal first (fsync), then Convex; an unconfirmed final goes to the delivery loop (point 34c). */
async function finalize({ runId, final, journal, background }: { runId: string; final: JournalFinal; journal: RunJournal; background: Background }) {
  background.running.delete(runId);
  try {
    journal.final(final);
  } catch {
    // Convex is the other copy.
  }
  try {
    if (await deliverFinal(runId, final)) {
      journal.remove();
      return;
    }
  } catch (error) {
    background.pending.set(runId, { runId, journal, final, attempts: 1, nextAt: Date.now() + runTiming().deliverMinMs, lastError: error instanceof Error ? error.message : String(error) });
    return;
  }
  background.pending.set(runId, { runId, journal, final, attempts: 1, nextAt: Date.now() + runTiming().deliverMinMs });
}

function uiStreamResponse(fill: (sink: ClientSink) => void, status = 200): Response {
  const { readable, writable } = new TransformStream<UIMessageChunk, UIMessageChunk>();
  const sink = clientSink(writable.getWriter());
  fill(sink);
  return createUIMessageStreamResponse({ stream: readable, status, headers: { "cache-control": "no-store" } });
}

/** A short stream for a run this request does not pump: the browser follows it through Convex. */
function followResponse(input: SendBody, reason: string): Response {
  return uiStreamResponse((sink) => {
    sink.write({ type: "start", messageId: `${input.runId}-a` });
    sink.write({ type: "data-run", data: { runId: input.runId, conversationId: input.conversationId, follow: true, reason } } as UIMessageChunk);
    sink.write({ type: "finish" });
    sink.close();
  });
}

/** POST /api/board/chat: the whole send path of point 81. */
export async function sendChat(input: SendBody): Promise<Response> {
  const background = chatBackground();
  const dispatcherId = background.instanceId;
  const prepared = await prepareRun(input);
  const decision = await claimRun(input, prepared.contextManifest, dispatcherId);
  if (decision.action === "follow") return followResponse(input, decision.reason);

  const journal = new RunJournal({ deploymentId: deploymentId(), ownerInstanceId: dispatcherId, runId: input.runId, restoreEpoch: input.restoreEpoch });
  const bridgeRequest = { ...prepared.request };
  let response: Response;
  try {
    response = await bridgeFetch("/v1/board/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bridgeRequest), timeoutMs: 15 * 60_000 });
  } catch (error) {
    const final: JournalFinal = { seq: 1, hash: sha(""), text: "", status: "error", error: { code: "bridge-unreachable", message: `Bridge nicht erreichbar. \`npm run dev:board\` starten. (${error instanceof Error ? error.message : "unbekannt"})` } };
    await finalize({ runId: input.runId, final, journal, background });
    throw new BoardApiError(502, "bridge-unreachable", final.error!.message, { runId: input.runId });
  }
  if (!response.ok || !response.headers.get("content-type")?.includes("ndjson")) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    if (response.status === 409 && data.code === "duplicate") {
      journal.remove();
      return followResponse(input, "bridge-duplicate");
    }
    const final: JournalFinal = { seq: 1, hash: sha(""), text: "", status: "error", error: { code: data.code ?? `http-${response.status}`, message: data.error ?? `Die Bridge hat mit ${response.status} geantwortet.` } };
    await finalize({ runId: input.runId, final, journal, background });
    const retryAfter = response.headers.get("retry-after");
    throw new BoardApiError(response.status === 429 ? 429 : response.status >= 500 ? 502 : 409, data.code ?? "bridge", final.error!.message, { runId: input.runId, ...(retryAfter ? { retryAfter: Number(retryAfter) } : {}) });
  }

  return uiStreamResponse((sink) => {
    sink.write({ type: "start", messageId: `${input.runId}-a` });
    sink.write({ type: "data-run", data: { runId: input.runId, conversationId: input.conversationId, conversationCreated: decision.conversationCreated } } as UIMessageChunk);
    background.running.set(input.runId, { abort: () => void response.body?.cancel().catch(() => {}) });
    void pump({ input, generation: decision.generation, dispatcherId, response, journal, sink, background }).catch(() => sink.close());
  });
}

// ---------------------------------------------------------------------------
// Stop

type RunInfo = { conversationId: string; boardId: string; message: { text: string; seq: number; status: string; terminal: boolean }; activeRun: ActiveRun } | null;

/**
 * Stop button (points 34, 85): the bridge ends the engine; the pump then
 * writes `aborted`. Without a live run anywhere, the stop route itself closes
 * the answer as `aborted` with the text saved so far.
 */
export async function stopRun(runId: string): Promise<{ state: string }> {
  if (!RUN_ID.test(runId)) throw new BoardApiError(400, "invalid", "Ungültige runId.");
  const convex = boardConvex();
  const info = await convex.query<RunInfo>("boardChat:runInfo", { runId });
  if (!info) throw new BoardApiError(404, "not-found", "Lauf nicht gefunden.");
  if (info.message.terminal) return { state: info.message.status };
  const response = await bridgeFetch(`/v1/board/chat/${encodeURIComponent(runId)}/abort`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", timeoutMs: 5_000 }).catch(() => null);
  const data = response?.ok ? ((await response.json()) as { state: string }) : null;
  if (data?.state === "aborting") return { state: "aborting" };
  const background = chatBackground();
  if (background.running.has(runId)) return { state: "aborting" };
  if (data === null) throw new BoardApiError(502, "bridge-unreachable", "Bridge nicht erreichbar. `npm run dev:board` starten.");
  await deliverFinal(runId, { seq: info.message.seq, hash: sha(info.message.text), text: info.message.text, status: "aborted", error: { code: "aborted", message: "Abgebrochen." } });
  return { state: "aborted" };
}

export function runStatus() {
  const background = globalForChat.__boardChatBackground;
  if (!background) return { instanceId: null, running: [], pending: [] };
  return {
    instanceId: background.instanceId,
    running: [...background.running.keys()],
    pending: [...background.pending.values()].map((entry) => ({ runId: entry.runId, attempts: entry.attempts, lastError: entry.lastError ?? null, stuck: Boolean(entry.stuck) })),
  };
}

// ---------------------------------------------------------------------------
// Context display (point 42)

export async function contextPreview({ boardId, chatNodeId, engine, modelId, brandVoice }: { boardId: string; chatNodeId: string; engine: EngineId; modelId: string; brandVoice: "none" | "chris" }) {
  const meta = await boardConvex().query<ChatSources>("boardChat:chatSources", { boardId, chatNodeId });
  const voice = brandVoiceFor(brandVoice, meta.brandVoiceText);
  const input = { text: "", engine, modelId: engine === "codex" ? CODEX_CONFIG_MODEL : modelId } as SendBody;
  const { check, sources } = precheckBudget(input, meta, voice);
  const notReady = meta.youtube.filter((entry) => entry.status !== "ready").map((entry) => ({ videoId: entry.videoId, status: entry.status, title: entry.title ?? meta.nodes.find((node) => node.videoId === entry.videoId)?.title ?? entry.videoId }));
  return {
    revision: meta.revision,
    sources,
    mentionable: meta.nodes.map((node) => ({ id: node.id, type: node.type, title: node.title, parentId: node.parentId ?? null })),
    notReady,
    estimatedTokens: check.estimatedTokens,
    budgetTokens: check.budgetTokens,
    ok: check.ok,
    brandVoice: { board: meta.brandVoiceText, fallback: defaultBrandVoice() },
  };
}
