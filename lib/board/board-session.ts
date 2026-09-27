import { UndoStack, newOpId, type Command } from "./commands.ts";
import { newNodeId } from "./ids.ts";
import { confirmsOp, confirmsVersion, journalKey, JournalWriteError, opKey, textKey, titleKey, type JournalEntry, type JournalScope, type JournalStore, type OpEntry, type TextEntry, type TitleEntry } from "./journal.ts";
import { assertTextBudget, TextTooLargeError } from "./limits.ts";
import { applyOpLocal, emptyModel, modelFrom, type BoardModel } from "./model.ts";
import { NODE_DEFAULTS, type BoardEdge, type BoardNode, type Op, type OpResult } from "./ops.ts";
import { OpQueue, realClock, type Clock, type QueueStatus, type SendResult, type TransportError } from "./op-queue.ts";
import { HEARTBEAT_MS } from "./lease.ts";
import { OPS_VERSION } from "./versions.ts";

/**
 * One open board in one tab (PLAN.md points 24 to 30). Every local change goes
 * journal → local model → op queue. The session owns the write lease, answers
 * conflicts (text: conflict copy, structure: reload) and decides which journal
 * entries of earlier sessions are replayed and which are only offered.
 */

export type BoardMeta = {
  id: string;
  title: string;
  videoSlug?: string;
  brandVoiceText: string;
  revision: number;
  nodeCount: number;
  restoreEpoch: number;
  mode: string;
  lease: { sessionId: string; generation: number; expiresAt: number } | null;
};

export type LeaseResponse =
  | { granted: true; generation: number; expiresAt: number; restoreEpoch: number; revision: number; takeover: boolean }
  | { granted: false; holderExpiresAt: number; revision: number };

export type BoardTransport = {
  getBoard(boardId: string): Promise<BoardMeta>;
  listNodes(boardId: string, cursor: string | null): Promise<{ page: BoardNode[]; isDone: boolean; continueCursor: string }>;
  listEdges(boardId: string, cursor: string | null): Promise<{ page: BoardEdge[]; isDone: boolean; continueCursor: string }>;
  getTexts(boardId: string, nodeIds: string[]): Promise<{ texts: { nodeId: string; blocks: string; rev: number }[]; pending: string[] }>;
  applyOps(body: { opsVersion: number; restoreEpoch: number; sessionId: string; leaseGeneration: number; oldestUnconfirmedAt?: number; ops: Op[] }): Promise<SendResult>;
  acquireLease(body: { opsVersion: number; sessionId: string; takeover: boolean }): Promise<LeaseResponse>;
  heartbeat(body: { sessionId: string; generation: number; oldestUnconfirmedAt?: number }): Promise<{ ok: boolean; expiresAt: number; revision: number; generation: number }>;
  releaseLease(body: { sessionId: string; generation: number }): void;
};

/** Liveness of editor sessions across tabs (Web Locks in the browser). */
export type SessionLocks = { hold(sessionId: string): void; isAlive(sessionId: string): Promise<boolean> };

export type SaveState = "saved" | "saving" | "offline" | "conflict" | "readonly" | "localfail" | "reload" | "loading";

export type TextState = { blocks: string | null; markdown: string; rev: number; localVersion: number; loaded: boolean };

export type Offer = { sessionId: string; entries: JournalEntry[] };

export type SessionSnapshot = {
  meta: BoardMeta | null;
  model: BoardModel;
  saveState: SaveState;
  writable: boolean;
  notice: string | null;
  offers: Offer[];
  canUndo: boolean;
  canRedo: boolean;
  version: number;
};

type Pending = { kind: "text" | "title"; nodeId: string; localVersion: number };

export type BoardSessionOptions = {
  boardId: string;
  deploymentId: string;
  editorSessionId: string;
  transport: BoardTransport;
  journal: JournalStore;
  locks: SessionLocks;
  clock?: Clock;
};

export class BoardSession {
  meta: BoardMeta | null = null;
  model: BoardModel = emptyModel();
  texts = new Map<string, TextState>();
  titles = new Map<string, { title: string; localVersion: number }>();
  saveState: SaveState = "loading";
  writable = false;
  notice: string | null = null;
  offers: Offer[] = [];
  undoStack = new UndoStack(50);
  version = 0;

  private queue: OpQueue;
  private lease: { generation: number; restoreEpoch: number } | null = null;
  private pendingByOp = new Map<string, Pending>();
  private listeners = new Set<() => void>();
  private heartbeatTimer: unknown = null;
  private clock: Clock;
  private localVersionCounter = 0;
  private snapshotCache: SessionSnapshot | null = null;
  private userEdits = 0;
  replaying = false;

  private options: BoardSessionOptions;

  constructor(options: BoardSessionOptions) {
    this.options = options;
    this.clock = options.clock ?? realClock;
    this.queue = new OpQueue({
      clock: this.clock,
      send: (ops, oldest) => this.send(ops, oldest),
      onResults: (ops, result) => this.onResults(ops, result),
      onFatal: (error) => this.onFatal(error),
      onTextDue: (key) => this.opsForDueKey(key),
      onStatus: (status) => this.onQueueStatus(status),
    });
  }

  // ---------- store plumbing for React (useSyncExternalStore) ----------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => {
    if (!this.snapshotCache || this.snapshotCache.version !== this.version) {
      this.snapshotCache = {
        meta: this.meta,
        model: this.model,
        saveState: this.saveState,
        writable: this.writable,
        notice: this.notice,
        offers: this.offers,
        canUndo: this.undoStack.canUndo,
        canRedo: this.undoStack.canRedo,
        version: this.version,
      };
    }
    return this.snapshotCache;
  };

  private emit() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private get scope(): JournalScope {
    return { deploymentId: this.options.deploymentId, boardId: this.options.boardId, editorSessionId: this.options.editorSessionId };
  }

  // ---------- loading ----------

  private async loadServerState() {
    const { transport, boardId } = this.options;
    const meta = await transport.getBoard(boardId);
    const nodes: BoardNode[] = [];
    const edges: BoardEdge[] = [];
    for (let cursor: string | null = null; ; ) {
      const page = await transport.listNodes(boardId, cursor);
      nodes.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    for (let cursor: string | null = null; ; ) {
      const page = await transport.listEdges(boardId, cursor);
      edges.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    this.meta = meta;
    this.model = modelFrom(nodes, edges);
    this.texts.clear();
    this.titles.clear();
    for (const node of nodes) {
      if (node.type === "textNode") this.texts.set(node.id, { blocks: null, markdown: node.textPreview ?? "", rev: node.textRev ?? 0, localVersion: 0, loaded: false });
    }
  }

  async open() {
    this.options.locks.hold(this.options.editorSessionId);
    await this.loadServerState();
    const entries = await this.options.journal.listBoard(this.options.deploymentId, this.options.boardId);
    const own = entries.filter((entry) => entry.editorSessionId === this.options.editorSessionId);
    const foreign = entries.filter((entry) => entry.editorSessionId !== this.options.editorSessionId);

    // Entries of a dead session written under the lease that is still current may be adopted:
    // nobody else has written since, so replaying them is exactly what that tab would have done.
    const adoptable: JournalEntry[] = [];
    const offered = new Map<string, JournalEntry[]>();
    const lease = this.meta?.lease;
    for (const entry of foreign) {
      const current = lease && entry.leaseSessionId === lease.sessionId && entry.leaseGeneration === lease.generation && entry.restoreEpoch === this.meta?.restoreEpoch;
      if (current && !(await this.options.locks.isAlive(entry.editorSessionId))) adoptable.push(entry);
      else offered.set(entry.editorSessionId, [...(offered.get(entry.editorSessionId) ?? []), entry]);
    }
    this.offers = [...offered].map(([sessionId, list]) => ({ sessionId, entries: list }));

    // A lease held by a tab that no longer exists (its Web Lock is gone) is taken over without a click.
    const holderDead = lease !== null && lease !== undefined && lease.sessionId !== this.options.editorSessionId && !(await this.options.locks.isAlive(lease.sessionId));
    const granted = await this.acquire(holderDead);
    if (granted) await this.replay([...own, ...adoptable]);
    else if (own.length > 0) {
      this.offers.push({ sessionId: this.options.editorSessionId, entries: own });
    }
    this.startHeartbeat();
    this.emit();
  }

  private async acquire(takeover: boolean, { resume = true }: { resume?: boolean } = {}): Promise<boolean> {
    const result = await this.options.transport.acquireLease({ opsVersion: OPS_VERSION, sessionId: this.options.editorSessionId, takeover });
    if (!result.granted) {
      this.lease = null;
      this.writable = false;
      this.saveState = "readonly";
      this.notice = "Ein anderer Tab bearbeitet dieses Board. Hier nur lesend.";
      this.queue.block();
      return false;
    }
    this.lease = { generation: result.generation, restoreEpoch: result.restoreEpoch };
    if (this.meta) this.meta = { ...this.meta, restoreEpoch: result.restoreEpoch, lease: { sessionId: this.options.editorSessionId, generation: result.generation, expiresAt: result.expiresAt } };
    this.writable = true;
    this.notice = null;
    this.saveState = "saved";
    if (resume) this.queue.unblock();
    return true;
  }

  /** "Hier bearbeiten": take the lease, reload the server state, clear undo, replay own entries with conflict check. */
  async takeOver() {
    // Drop the stale in-memory queue before the new lease can release it (the journal keeps everything).
    this.queue.block();
    this.queue.clearPending();
    this.pendingByOp.clear();
    const granted = await this.acquire(true, { resume: false });
    if (!granted) return;
    this.undoStack.clear();
    await this.loadServerState();
    const entries = await this.options.journal.listBoard(this.options.deploymentId, this.options.boardId);
    const own = entries.filter((entry) => entry.editorSessionId === this.options.editorSessionId);
    this.offers = this.offers.filter((offer) => offer.sessionId !== this.options.editorSessionId);
    this.queue.unblock();
    await this.replay(own);
    this.emit();
  }

  /**
   * Re-send journal entries after a load. Structure ops keep their opId (the
   * server answers "duplicate" if it already has them); texts and titles are
   * rebuilt from their entries with the base they were written against, so a
   * text changed elsewhere in the meantime becomes a conflict copy.
   */
  private async replay(entries: JournalEntry[]) {
    if (entries.length === 0) return;
    this.replaying = true;
    const ops = entries.filter((entry): entry is OpEntry => entry.kind === "op").sort((a, b) => a.updatedAt - b.updatedAt);
    for (const entry of ops) {
      if (entry.editorSessionId !== this.options.editorSessionId) {
        await this.options.journal.put({ ...entry, ...this.scope, ...this.leaseStamp(), updatedAt: this.clock.now() });
        await this.options.journal.remove(journalKey(entry));
      }
      this.queue.enqueue(entry.op);
    }
    for (const entry of entries.filter((e): e is TextEntry => e.kind === "text")) {
      const localVersion = this.nextLocalVersion();
      const adopted: TextEntry = { ...entry, ...this.scope, ...this.leaseStamp(), localVersion, updatedAt: this.clock.now() };
      await this.options.journal.put(adopted);
      if (entry.editorSessionId !== this.options.editorSessionId) await this.options.journal.remove(journalKey(entry));
      const state = this.texts.get(entry.nodeId);
      const node = this.model.nodes.get(entry.nodeId);
      if (!node || !state) {
        await this.conflictCopy(adopted, "Der Text-Node existiert nicht mehr.");
        continue;
      }
      // The entry's base is the last confirmed revision. Convex accepts it if only this session wrote
      // since then, and answers with a conflict if another tab did.
      const baseTextRev = entry.baseTextRev;
      this.texts.set(entry.nodeId, { ...state, blocks: entry.blocks, markdown: entry.markdown, localVersion, loaded: true });
      const op: Op = { opId: newOpId(), type: "text.set", nodeId: entry.nodeId, baseTextRev, blocks: entry.blocks, markdown: entry.markdown, ...(entry.provenance ? { provenance: entry.provenance } : {}) };
      this.model = applyOpLocal(this.model, op);
      this.pendingByOp.set(op.opId, { kind: "text", nodeId: entry.nodeId, localVersion });
      this.queue.enqueue(op);
    }
    for (const entry of entries.filter((e): e is TitleEntry => e.kind === "title")) {
      const localVersion = this.nextLocalVersion();
      await this.options.journal.put({ ...entry, ...this.scope, ...this.leaseStamp(), localVersion, updatedAt: this.clock.now() });
      if (entry.editorSessionId !== this.options.editorSessionId) await this.options.journal.remove(journalKey(entry));
      this.titles.set(entry.nodeId, { title: entry.title, localVersion });
      this.queue.touchText(`title:${entry.nodeId}`);
    }
    this.emit();
    // Settle in the background so a missing network never blocks the board. Once everything is
    // confirmed and nobody edited meanwhile, reload so replayed structure ops show exactly as stored.
    const editsBefore = this.userEdits;
    void this.queue
      .flush()
      .then(async () => {
        this.replaying = false;
        if (this.userEdits === editsBefore && this.queue.size === 0) {
          await this.loadServerState();
          this.emit();
        }
      })
      .catch(() => {
        this.replaying = false;
      });
  }

  private leaseStamp() {
    return { leaseSessionId: this.options.editorSessionId, leaseGeneration: this.lease?.generation ?? 0, opsVersion: OPS_VERSION, restoreEpoch: this.lease?.restoreEpoch ?? this.meta?.restoreEpoch ?? 1 };
  }

  private nextLocalVersion() {
    this.localVersionCounter += 1;
    return this.clock.now() * 1000 + (this.localVersionCounter % 1000);
  }

  // ---------- local changes ----------

  private failLocal(error: unknown) {
    this.writable = false;
    this.saveState = "localfail";
    this.notice = error instanceof JournalWriteError ? error.message : "Lokale Sicherung fehlgeschlagen.";
    this.queue.block();
    this.emit();
  }

  /** Journal first, then the local model, then the network. */
  async run(command: Command, { recordUndo = true } = {}): Promise<boolean> {
    if (!this.writable || command.ops.length === 0) return false;
    try {
      for (const op of command.ops) await this.options.journal.put({ ...this.scope, ...this.leaseStamp(), kind: "op", entryKey: opKey(op.opId), op, updatedAt: this.clock.now() });
    } catch (error) {
      this.failLocal(error);
      return false;
    }
    if (recordUndo) this.userEdits += 1;
    if (recordUndo && this.saveState === "conflict") this.saveState = "saving";
    for (const op of command.ops) this.model = applyOpLocal(this.model, op);
    for (const op of command.ops) {
      if (op.type === "node.create" && op.node.type === "textNode") {
        this.texts.set(op.node.id, { blocks: op.text?.blocks ?? "", markdown: op.text?.markdown ?? "", rev: 1, localVersion: 0, loaded: true });
      }
      this.queue.enqueue(op);
    }
    if (recordUndo && command.undo) this.undoStack.push(command.undo);
    this.emit();
    return true;
  }

  async undo() {
    if (!this.writable) return;
    const ops = this.undoStack.undo(this.model);
    await this.run({ ops, undo: null }, { recordUndo: false });
    this.emit();
  }

  async redo() {
    if (!this.writable) return;
    const ops = this.undoStack.redo(this.model);
    await this.run({ ops, undo: null }, { recordUndo: false });
    this.emit();
  }

  /** Every keystroke: journal without throttling, the network op follows the 400 ms debounce. */
  async setText(nodeId: string, blocks: string, markdown: string): Promise<boolean> {
    if (!this.writable) return false;
    try {
      assertTextBudget({ blocks, markdown });
    } catch (error) {
      this.notice = error instanceof TextTooLargeError ? error.message : "Text zu groß, bitte aufteilen.";
      this.emit();
      return false;
    }
    const state = this.texts.get(nodeId) ?? { blocks: null, markdown: "", rev: this.model.nodes.get(nodeId)?.textRev ?? 0, localVersion: 0, loaded: true };
    const localVersion = this.nextLocalVersion();
    try {
      // The base is the last revision the server confirmed, never a predicted one (see applyTextSet).
      await this.options.journal.put({ ...this.scope, ...this.leaseStamp(), kind: "text", entryKey: textKey(nodeId), nodeId, blocks, markdown, localVersion, baseTextRev: state.rev, updatedAt: this.clock.now() });
    } catch (error) {
      this.failLocal(error);
      return false;
    }
    this.texts.set(nodeId, { ...state, blocks, markdown, localVersion, loaded: true });
    this.userEdits += 1;
    if (this.saveState === "conflict") this.saveState = "saving";
    this.queue.touchText(nodeId);
    if (this.notice?.startsWith("Text zu groß")) this.notice = null;
    this.emit();
    return true;
  }

  async setTitle(nodeId: string, title: string): Promise<boolean> {
    if (!this.writable || !this.model.nodes.has(nodeId)) return false;
    const localVersion = this.nextLocalVersion();
    try {
      await this.options.journal.put({ ...this.scope, ...this.leaseStamp(), kind: "title", entryKey: titleKey(nodeId), nodeId, title, localVersion, updatedAt: this.clock.now() });
    } catch (error) {
      this.failLocal(error);
      return false;
    }
    this.titles.set(nodeId, { title, localVersion });
    const node = this.model.nodes.get(nodeId)!;
    this.model = { ...this.model, nodes: new Map(this.model.nodes).set(nodeId, { ...node, data: { ...node.data, title } }) };
    this.queue.touchText(`title:${nodeId}`);
    this.emit();
    return true;
  }

  async renameBoard(title: string) {
    const clean = title.trim();
    if (!clean || !this.meta || clean === this.meta.title) return;
    const ok = await this.run({ ops: [{ opId: newOpId(), type: "board.update", patch: { title: clean.slice(0, 200) } }], undo: null }, { recordUndo: false });
    if (ok && this.meta) {
      this.meta = { ...this.meta, title: clean.slice(0, 200) };
      this.emit();
    }
  }

  titleFor(nodeId: string): string {
    return this.titles.get(nodeId)?.title ?? this.model.nodes.get(nodeId)?.data.title ?? "";
  }

  /** Called by the queue when a debounce fires: build the op against the predicted revision. */
  private opsForDueKey(key: string): Op[] {
    if (key.startsWith("title:")) {
      const nodeId = key.slice(6);
      const local = this.titles.get(nodeId);
      const node = this.model.nodes.get(nodeId);
      if (!local || !node) return [];
      const op: Op = { opId: newOpId(), type: "node.update", nodeId, baseRev: node.rev, patch: { data: { title: local.title } } };
      this.model = applyOpLocal(this.model, op);
      this.pendingByOp.set(op.opId, { kind: "title", nodeId, localVersion: local.localVersion });
      return [op];
    }
    const nodeId = key;
    const state = this.texts.get(nodeId);
    const node = this.model.nodes.get(nodeId);
    if (!state || !node || state.blocks === null) return [];
    const op: Op = { opId: newOpId(), type: "text.set", nodeId, baseTextRev: node.textRev ?? state.rev, blocks: state.blocks, markdown: state.markdown };
    this.model = applyOpLocal(this.model, op);
    this.pendingByOp.set(op.opId, { kind: "text", nodeId, localVersion: state.localVersion });
    return [op];
  }

  // ---------- network ----------

  private async send(ops: Op[], oldest: number | undefined): Promise<SendResult> {
    if (!this.lease) throw { kind: "fatal", errorKind: "lease", message: "Keine Schreib-Lease." } satisfies TransportError;
    return this.options.transport.applyOps({ opsVersion: OPS_VERSION, restoreEpoch: this.lease.restoreEpoch, sessionId: this.options.editorSessionId, leaseGeneration: this.lease.generation, oldestUnconfirmedAt: oldest, ops });
  }

  private async onResults(ops: Op[], result: SendResult) {
    if (this.meta) this.meta = { ...this.meta, revision: result.revision };
    const byId = new Map(result.results.map((entry) => [entry.opId, entry]));
    let structureConflict = false;
    for (const op of ops) {
      const outcome: OpResult | undefined = byId.get(op.opId);
      const pending = this.pendingByOp.get(op.opId);
      this.pendingByOp.delete(op.opId);
      if (!outcome) continue;
      if (outcome.status === "conflict") {
        if (op.type === "text.set") await this.onTextConflict(op, pending);
        else if (op.type === "node.update" && pending?.kind === "title") await this.confirmTitle(pending);
        else structureConflict = true;
        if (!pending) await this.options.journal.remove(journalKey({ ...this.scope, entryKey: opKey(op.opId) }));
        continue;
      }
      if (pending?.kind === "text") {
        await this.options.journal.confirm(journalKey({ ...this.scope, entryKey: textKey(pending.nodeId) }), confirmsVersion(pending.localVersion));
        const state = this.texts.get(pending.nodeId);
        if (state && outcome.textRev !== undefined) this.texts.set(pending.nodeId, { ...state, rev: outcome.textRev });
      } else if (pending?.kind === "title") {
        await this.confirmTitle(pending);
      } else {
        await this.options.journal.confirm(journalKey({ ...this.scope, entryKey: opKey(op.opId) }), confirmsOp(op.opId));
      }
    }
    if (structureConflict) await this.reloadAfterConflict();
    this.emit();
  }

  private async confirmTitle(pending: Pending) {
    await this.options.journal.confirm(journalKey({ ...this.scope, entryKey: titleKey(pending.nodeId) }), confirmsVersion(pending.localVersion));
    if (this.titles.get(pending.nodeId)?.localVersion === pending.localVersion) this.titles.delete(pending.nodeId);
  }

  /** Text conflict (point 27): reload the server state, then the local content becomes a new text node. */
  private async onTextConflict(op: Extract<Op, { type: "text.set" }>, pending: Pending | undefined) {
    const entry: TextEntry = {
      ...this.scope,
      ...this.leaseStamp(),
      kind: "text",
      entryKey: textKey(op.nodeId),
      nodeId: op.nodeId,
      blocks: op.blocks,
      markdown: op.markdown,
      localVersion: pending?.localVersion ?? 0,
      baseTextRev: op.baseTextRev,
      updatedAt: this.clock.now(),
    };
    // The newest local text of this node, if the user kept typing after this op, goes into the copy.
    const stored = (await this.options.journal.listBoard(this.options.deploymentId, this.options.boardId)).find(
      (candidate): candidate is TextEntry => candidate.kind === "text" && candidate.editorSessionId === this.options.editorSessionId && candidate.nodeId === op.nodeId,
    );
    const latest = stored ?? entry;
    if (stored) await this.options.journal.remove(journalKey(stored));
    await this.reloadAfterConflict();
    await this.conflictCopy(latest, "Der Text wurde inzwischen anderswo geändert.");
  }

  private async conflictCopy(entry: TextEntry, reason: string) {
    const original = this.model.nodes.get(entry.nodeId);
    const id = newNodeId("textNode");
    const position = original ? { x: original.position.x + 40, y: original.position.y + 40 } : { x: 80, y: 80 };
    const title = `Konfliktkopie${original?.data.title ? `: ${original.data.title}` : ""}`.slice(0, 200);
    const shape = { id, type: "textNode" as const, position, width: NODE_DEFAULTS.textNode.width, height: NODE_DEFAULTS.textNode.height, zIndex: NODE_DEFAULTS.textNode.zIndex, ...(original?.parentId ? { parentId: original.parentId } : {}), data: { title } };
    const op: Op = { opId: newOpId(), type: "node.create", node: shape, text: { blocks: entry.blocks, markdown: entry.markdown } };
    await this.run({ ops: [op], undo: null }, { recordUndo: false });
    if (entry.editorSessionId !== this.options.editorSessionId) await this.options.journal.remove(journalKey(entry));
    this.saveState = "conflict";
    this.notice = `${reason} Deine Fassung liegt als Konfliktkopie daneben.`;
  }

  /**
   * Structure conflict (point 27): the server wins. Pending structure ops are dropped, the
   * board reloads, undo is cleared, and texts or titles still waiting in the journal are
   * replayed against the fresh state (a text changed elsewhere becomes a conflict copy).
   */
  private async reloadAfterConflict() {
    this.queue.clearPending();
    this.pendingByOp.clear();
    const entries = await this.options.journal.listBoard(this.options.deploymentId, this.options.boardId);
    const own = entries.filter((entry) => entry.editorSessionId === this.options.editorSessionId);
    for (const entry of own) if (entry.kind === "op") await this.options.journal.remove(journalKey(entry));
    await this.loadServerState();
    this.undoStack.clear();
    this.saveState = "reload";
    this.notice = "Das Board hat sich geändert und wurde neu geladen.";
    await this.replay(own.filter((entry) => entry.kind !== "op"));
    this.emit();
  }

  private onFatal(error: TransportError) {
    this.writable = false;
    if (error.errorKind === "lease") {
      this.saveState = "readonly";
      this.notice = "Ein anderer Tab bearbeitet dieses Board. Hier nur lesend.";
    } else if (error.errorKind === "version") {
      this.saveState = "reload";
      this.notice = "Board neu laden: Die Seite ist älter als der Server.";
    } else if (error.errorKind === "readonly" || error.errorKind === "draining" || error.errorKind === "restoring") {
      this.saveState = "readonly";
      this.notice = error.message;
    } else {
      this.saveState = "readonly";
      this.notice = error.message;
    }
    this.emit();
  }

  private onQueueStatus(status: QueueStatus) {
    if (this.saveState === "localfail" || this.saveState === "readonly" || this.saveState === "reload") return;
    // "Konflikt" stays visible until the next own edit.
    if (this.saveState === "conflict" && (status === "saving" || status === "saved")) return;
    this.saveState = status === "blocked" ? "readonly" : status;
    this.emit();
  }

  // ---------- lease heartbeat ----------

  private startHeartbeat() {
    const beat = async () => {
      this.heartbeatTimer = this.clock.setTimeout(() => void beat(), HEARTBEAT_MS);
      if (!this.lease) return;
      try {
        const result = await this.options.transport.heartbeat({ sessionId: this.options.editorSessionId, generation: this.lease.generation, oldestUnconfirmedAt: this.queue.oldestUnconfirmedAt() });
        if (!result.ok) {
          this.lease = null;
          this.queue.block();
          this.onFatal({ kind: "fatal", errorKind: "lease", message: "Lease verloren." });
        }
      } catch {
        // offline: the queue shows it; the lease stays ours until someone else takes it
      }
    };
    this.heartbeatTimer = this.clock.setTimeout(() => void beat(), HEARTBEAT_MS);
  }

  close() {
    if (this.heartbeatTimer !== null) this.clock.clearTimeout(this.heartbeatTimer);
    if (this.lease && this.queue.size === 0) this.options.transport.releaseLease({ sessionId: this.options.editorSessionId, generation: this.lease.generation });
  }

  /** Point 32: wait until journal and queue are confirmed. Throws if saving is blocked. */
  async flush() {
    await this.queue.flush();
  }

  get pendingCount() {
    return this.queue.size;
  }

  // ---------- texts on demand ----------

  async ensureTexts(nodeIds: string[]) {
    const missing = nodeIds.filter((id) => this.texts.get(id) && !this.texts.get(id)!.loaded);
    let pending = missing;
    while (pending.length > 0) {
      const result = await this.options.transport.getTexts(this.options.boardId, pending);
      for (const text of result.texts) {
        const state = this.texts.get(text.nodeId);
        if (!state || state.loaded) continue;
        this.texts.set(text.nodeId, { ...state, blocks: text.blocks, rev: text.rev, loaded: true });
      }
      if (result.pending.length === pending.length) break;
      pending = result.pending;
    }
    this.emit();
  }

  // ---------- offers from other sessions ----------

  /** Unconfirmed changes of earlier or other sessions become conflict copies, only on click (point 28). */
  async acceptOffers() {
    if (!this.writable) return;
    for (const offer of this.offers) {
      for (const entry of offer.entries) {
        if (entry.kind === "text") await this.conflictCopy(entry, "Übernommen aus einer früheren Sitzung.");
        else await this.options.journal.remove(journalKey(entry));
      }
    }
    this.offers = [];
    this.emit();
  }

  async discardOffers() {
    for (const offer of this.offers) for (const entry of offer.entries) await this.options.journal.remove(journalKey(entry));
    this.offers = [];
    this.emit();
  }

  setNotice(notice: string | null) {
    this.notice = notice;
    this.emit();
  }
}
