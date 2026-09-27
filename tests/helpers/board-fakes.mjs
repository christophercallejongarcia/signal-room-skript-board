/**
 * Test doubles for the board client: a manual clock, a fake server with the same
 * conflict rules as Convex (rev checks, opId idempotency, lease), and fake locks.
 */
import { applyOpLocal, modelFrom } from "../../lib/board/model.ts";
import { decideLease, leaseAllowsWrite } from "../../lib/board/lease.ts";

export class ManualClock {
  time = 1_000_000;
  timers = new Map();
  nextId = 1;
  now = () => this.time;
  setTimeout = (fn, ms) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, fn });
    return id;
  };
  clearTimeout = (id) => {
    this.timers.delete(id);
  };
  /** Advance time, running due timers in order and letting their promises settle. */
  async advance(ms) {
    const target = this.time + ms;
    for (;;) {
      await settle();
      const due = [...this.timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].fn();
    }
    this.time = target;
    await settle();
  }
}

export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

export class FakeServer {
  constructor(nodes = [], edges = []) {
    this.model = modelFrom(nodes, edges);
    this.textRevs = new Map(nodes.filter((n) => n.type === "textNode").map((n) => [n.id, n.textRev ?? 1]));
    this.texts = new Map();
    this.writers = new Map();
    this.applied = new Set();
    this.revision = 0;
    this.lease = undefined;
    this.offline = false;
    this.calls = [];
  }

  apply({ sessionId, leaseGeneration, ops }) {
    if (this.offline) throw { kind: "offline", message: "offline" };
    if (!leaseAllowsWrite(this.lease, sessionId, leaseGeneration)) throw { kind: "fatal", errorKind: "lease", message: "lease" };
    this.calls.push(ops.map((op) => op.type));
    const results = [];
    for (const op of ops) {
      if (this.applied.has(op.opId)) {
        results.push({ opId: op.opId, status: "duplicate" });
        continue;
      }
      const conflict = this.conflictOf(op, sessionId);
      if (conflict) {
        results.push({ opId: op.opId, status: "conflict", reason: conflict });
        continue;
      }
      this.model = applyOpLocal(this.model, op);
      if (op.type === "text.set") {
        this.writers.set(op.nodeId, sessionId);
        this.textRevs.set(op.nodeId, (this.textRevs.get(op.nodeId) ?? 0) + 1);
        this.texts.set(op.nodeId, { blocks: op.blocks, markdown: op.markdown });
      }
      if (op.type === "node.create" && op.node.type === "textNode") {
        this.textRevs.set(op.node.id, 1);
        this.texts.set(op.node.id, { blocks: op.text?.blocks ?? "", markdown: op.text?.markdown ?? "" });
      }
      this.applied.add(op.opId);
      this.revision += 1;
      results.push({ opId: op.opId, status: "applied", ...(op.type === "text.set" ? { textRev: this.textRevs.get(op.nodeId) } : {}) });
    }
    return { revision: this.revision, results };
  }

  conflictOf(op, sessionId) {
    const rev = (id) => this.model.nodes.get(id)?.rev;
    if (op.type === "node.update" && rev(op.nodeId) !== op.baseRev) return "rev";
    if (op.type === "text.set") {
      const rev = this.textRevs.get(op.nodeId) ?? 0;
      if (rev !== op.baseTextRev && (op.baseTextRev > rev || this.writers.get(op.nodeId) !== sessionId)) return "text";
    }
    if (op.type === "nodes.delete" && op.nodes.some((n) => rev(n.nodeId) !== n.baseRev)) return "rev";
    if (op.type === "group.create" && op.children.some((c) => rev(c.nodeId) !== c.baseRev)) return "rev";
    if (op.type === "group.dissolve" && rev(op.groupId) !== op.baseRev) return "rev";
    return null;
  }

  /** A second writer changes a text directly (another tab under its own lease). */
  writeTextAsOther(nodeId, markdown) {
    this.textRevs.set(nodeId, (this.textRevs.get(nodeId) ?? 0) + 1);
    this.writers.set(nodeId, "other");
    this.texts.set(nodeId, { blocks: `["${markdown}"]`, markdown });
    const node = this.model.nodes.get(nodeId);
    this.model.nodes.set(nodeId, { ...node, textRev: this.textRevs.get(nodeId) });
  }

  transport(boardId = "long-firefly-Blk7C") {
    const server = this;
    return {
      async getBoard() {
        return { id: boardId, title: "Test", brandVoiceText: "", revision: server.revision, nodeCount: server.model.nodes.size, restoreEpoch: 1, mode: "open", lease: server.lease ? { sessionId: server.lease.sessionId, generation: server.lease.generation, expiresAt: server.lease.expiresAt } : null };
      },
      async listNodes() {
        return { page: [...server.model.nodes.values()].map((n) => ({ ...n, textRev: server.textRevs.get(n.id) ?? n.textRev })), isDone: true, continueCursor: "" };
      },
      async listEdges() {
        return { page: [...server.model.edges.values()], isDone: true, continueCursor: "" };
      },
      async getTexts(_b, ids) {
        return { texts: ids.map((id) => ({ nodeId: id, blocks: server.texts.get(id)?.blocks ?? "[]", rev: server.textRevs.get(id) ?? 0 })), pending: [] };
      },
      async applyOps(body) {
        return server.apply(body);
      },
      async acquireLease({ sessionId, takeover }) {
        const decision = decideLease(server.lease, { sessionId, now: 1_000_000, takeover, restoreEpoch: 1 });
        if (decision.action === "deny") return { granted: false, holderExpiresAt: decision.holderExpiresAt, revision: server.revision };
        server.lease = decision.lease;
        return { granted: true, generation: decision.lease.generation, expiresAt: decision.lease.expiresAt, restoreEpoch: 1, revision: server.revision, takeover };
      },
      async heartbeat({ sessionId, generation }) {
        return { ok: leaseAllowsWrite(server.lease, sessionId, generation), expiresAt: 0, revision: server.revision, generation: server.lease?.generation ?? 0 };
      },
      releaseLease() {},
    };
  }
}

export class FakeLocks {
  alive = new Set();
  hold(id) {
    this.alive.add(id);
  }
  async isAlive(id) {
    return this.alive.has(id);
  }
}

export function textNode(id, x = 0, y = 0, extra = {}) {
  return { id, type: "textNode", position: { x, y }, width: 500, height: 300, zIndex: 1, data: { title: "" }, rev: 1, textRev: 1, ...extra };
}

export function chatNode(id, x = 900, y = 0) {
  return { id, type: "chatNode", position: { x, y }, width: 800, height: 700, zIndex: 10, data: { title: "" }, rev: 1 };
}
