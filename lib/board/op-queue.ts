import { LIMITS, utf8Bytes } from "./limits.ts";
import type { Op, OpResult } from "./ops.ts";

/**
 * Network side of saving (PLAN.md point 25). Ops are journaled before they get
 * here. The queue sends them in order, one request at a time, at most 100 ops
 * or about 3.5 MB per request, and retries with backoff 1, 2, 5, 10 s.
 * Text changes are debounced per node (400 ms) and only then turned into ops.
 */

export type QueueStatus = "saved" | "saving" | "offline" | "blocked";

export type SendResult = { revision: number; results: OpResult[] };

export type TransportError = { kind: "offline" | "server" | "fatal"; status?: number; errorKind?: string; message: string };

export type Clock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];
export const TEXT_DEBOUNCE_MS = 400;
const BATCH_BYTES = 3.5 * 1024 * 1024;

type Pending = { op: Op; enqueuedAt: number };

export type OpQueueOptions = {
  send(ops: Op[], oldestUnconfirmedAt: number | undefined): Promise<SendResult>;
  onResults(ops: Op[], result: SendResult): Promise<void> | void;
  onFatal(error: TransportError): void;
  /** Called when a node's text debounce fires; returns the op(s) to send for it. */
  onTextDue?(nodeId: string): Promise<Op[]> | Op[];
  onStatus?(status: QueueStatus): void;
  clock?: Clock;
};

export class OpQueue {
  private pending: Pending[] = [];
  private inFlight: Pending[] | null = null;
  private textTimers = new Map<string, unknown>();
  private retryTimer: unknown = null;
  private attempt = 0;
  private blocked = false;
  private status: QueueStatus = "saved";
  private idleWaiters: (() => void)[] = [];
  private clock: Clock;

  private options: OpQueueOptions;

  constructor(options: OpQueueOptions) {
    this.options = options;
    this.clock = options.clock ?? realClock;
  }

  get size() {
    return this.pending.length + (this.inFlight?.length ?? 0) + this.textTimers.size;
  }

  get currentStatus() {
    return this.status;
  }

  oldestUnconfirmedAt(): number | undefined {
    const first = this.inFlight?.[0] ?? this.pending[0];
    return first?.enqueuedAt;
  }

  enqueue(op: Op) {
    this.pending.push({ op, enqueuedAt: this.clock.now() });
    this.pump();
  }

  /** A node's text changed locally; the op follows 400 ms after the last change. */
  touchText(nodeId: string) {
    const existing = this.textTimers.get(nodeId);
    if (existing !== undefined) this.clock.clearTimeout(existing);
    this.textTimers.set(
      nodeId,
      this.clock.setTimeout(() => void this.fireText(nodeId), TEXT_DEBOUNCE_MS),
    );
    this.setStatus(this.blocked ? "blocked" : "saving");
  }

  private async fireText(nodeId: string) {
    this.textTimers.delete(nodeId);
    const ops = (await this.options.onTextDue?.(nodeId)) ?? [];
    for (const op of ops) this.pending.push({ op, enqueuedAt: this.clock.now() });
    this.pump();
  }

  /** Fire all text debounces now and resolve once nothing is pending or in flight (point 32). */
  async flush(): Promise<void> {
    for (const [nodeId, handle] of [...this.textTimers]) {
      this.clock.clearTimeout(handle);
      await this.fireText(nodeId);
    }
    if (this.retryTimer !== null) {
      this.clock.clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.pump();
    }
    if (this.size === 0) return;
    if (this.blocked) throw new Error("Speichern ist gesperrt.");
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  /** Stop sending (lease lost, version too old). Pending ops stay and stay journaled. */
  block() {
    this.blocked = true;
    this.setStatus("blocked");
  }

  /** Resume after a takeover; the caller has replaced the pending list if needed. */
  unblock() {
    this.blocked = false;
    this.attempt = 0;
    this.pump();
  }

  /** Drop everything not yet sent (structure conflict → reload). */
  clearPending() {
    this.pending = [];
    for (const handle of this.textTimers.values()) this.clock.clearTimeout(handle);
    this.textTimers.clear();
  }

  pendingOps(): Op[] {
    return [...(this.inFlight ?? []), ...this.pending].map((entry) => entry.op);
  }

  private setStatus(status: QueueStatus) {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }

  private takeBatch(): Pending[] {
    const batch: Pending[] = [];
    let bytes = 0;
    while (this.pending.length > 0 && batch.length < LIMITS.opsPerBatch) {
      const size = utf8Bytes(JSON.stringify(this.pending[0].op));
      if (batch.length > 0 && bytes + size > BATCH_BYTES) break;
      bytes += size;
      batch.push(this.pending.shift()!);
    }
    return batch;
  }

  private pump() {
    if (this.inFlight || this.blocked || this.retryTimer !== null) return;
    if (this.pending.length === 0) {
      if (this.textTimers.size === 0) {
        this.setStatus("saved");
        const waiters = this.idleWaiters.splice(0);
        for (const resolve of waiters) resolve();
      }
      return;
    }
    const batch = this.takeBatch();
    this.inFlight = batch;
    this.setStatus(this.attempt > 0 ? "offline" : "saving");
    void this.sendBatch(batch);
  }

  private async sendBatch(batch: Pending[]) {
    try {
      const result = await this.options.send(
        batch.map((entry) => entry.op),
        batch[0]?.enqueuedAt,
      );
      this.inFlight = null;
      this.attempt = 0;
      await this.options.onResults(
        batch.map((entry) => entry.op),
        result,
      );
      this.pump();
    } catch (raw) {
      const error = raw as TransportError;
      // Put the batch back in front, in order.
      this.pending = [...batch, ...this.pending];
      this.inFlight = null;
      if (error?.kind === "fatal") {
        this.block();
        this.options.onFatal(error);
        return;
      }
      const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
      this.attempt += 1;
      this.setStatus("offline");
      this.retryTimer = this.clock.setTimeout(() => {
        this.retryTimer = null;
        this.pump();
      }, delay);
    }
  }
}
