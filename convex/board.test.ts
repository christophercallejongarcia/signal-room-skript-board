/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { edgeId } from "../lib/board/ids";
import { LIMITS } from "../lib/board/limits";

const modules = import.meta.glob("./**/*.ts");
const token = "t".repeat(64);
const S1 = "session-aaaa1111";
const S2 = "session-bbbb2222";

beforeEach(() => vi.stubEnv("BOARD_ACCESS_TOKEN", token));
afterEach(() => vi.unstubAllEnvs());

type T = ReturnType<typeof convexTest>;
let opCounter = 0;
const opId = () => `op-${(opCounter += 1).toString().padStart(6, "0")}`;

function node(id: string, type: "textNode" | "youtubeNode" | "chatNode" | "groupNode", x = 0, y = 0, extra: Record<string, unknown> = {}) {
  const size = { textNode: [500, 300], youtubeNode: [290, 206], chatNode: [800, 700], groupNode: [400, 300] }[type];
  return { id, type, position: { x, y }, width: size[0], height: size[1], zIndex: type === "chatNode" ? 10 : type === "groupNode" ? -1 : 1, data: { title: "" }, ...extra };
}

async function setup(t: T, boardId = "long-firefly-Blk7C", sessionId = S1) {
  await t.mutation(api.boards.create, { token, opsVersion: 1, id: boardId, title: "Kupfernes Kaninchen" });
  const lease = await t.mutation(api.boardLease.acquire, { token, opsVersion: 1, boardId, sessionId, takeover: false });
  if (!lease.granted) throw new Error("no lease");
  return { boardId, sessionId, generation: lease.generation };
}

async function apply(t: T, ctx: { boardId: string; sessionId: string; generation: number }, ops: unknown[]) {
  return t.mutation(api.boardOps.applyOps, { token, opsVersion: 1, restoreEpoch: 1, boardId: ctx.boardId, sessionId: ctx.sessionId, leaseGeneration: ctx.generation, ops });
}

async function nodes(t: T, boardId: string) {
  const all = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { page: { id: string; parentId?: string; rev: number; position: { x: number; y: number } }[]; isDone: boolean; continueCursor: string } = await t.query(api.boardLoad.listNodes, { token, boardId, paginationOpts: { numItems: 200, cursor } });
    all.push(...page.page);
    if (page.isDone) return all;
    cursor = page.continueCursor;
  }
}

async function edges(t: T, boardId: string) {
  const page = await t.query(api.boardLoad.listEdges, { token, boardId, paginationOpts: { numItems: 200, cursor: null } });
  return page.page.map((edge: { id: string }) => edge.id).sort();
}

describe("board lifecycle", () => {
  test("create, rename, soft delete and a wrong token", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const renamed = await t.mutation(api.boards.rename, { token, opsVersion: 1, boardId: "long-firefly-Blk7C", title: "Video 2: Claude als Chef" });
    expect(renamed.title).toBe("Video 2: Claude als Chef");
    expect((await t.query(api.boards.list, { token }))[0]).toMatchObject({ id: "long-firefly-Blk7C", title: "Video 2: Claude als Chef" });
    await t.mutation(api.boards.remove, { token, opsVersion: 1, boardId: "long-firefly-Blk7C" });
    expect(await t.query(api.boards.list, { token })).toEqual([]);
    await expect(t.query(api.boardLoad.getBoard, { token, boardId: "long-firefly-Blk7C" })).rejects.toThrow(/nicht gefunden/);
    const stored = await t.run(async (ctx) => ctx.db.query("boards").collect());
    expect(stored[0].deletedAt).toBeTypeOf("number");
    await expect(t.query(api.boards.list, { token: "x".repeat(64) })).rejects.toThrow(/verweigert/);
    await expect(t.mutation(api.boards.rename, { token: "x".repeat(64), opsVersion: 1, boardId: "long-firefly-Blk7C", title: "x" })).rejects.toThrow(/verweigert/);
  });
});

describe("lease", () => {
  test("a second tab is denied, takes over with a higher generation, and the old generation can no longer write", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    expect(a.generation).toBe(1);
    const denied = await t.mutation(api.boardLease.acquire, { token, opsVersion: 1, boardId: a.boardId, sessionId: S2, takeover: false });
    expect(denied.granted).toBe(false);
    const b = await t.mutation(api.boardLease.acquire, { token, opsVersion: 1, boardId: a.boardId, sessionId: S2, takeover: true });
    expect(b).toMatchObject({ granted: true, generation: 2, takeover: true });
    await expect(apply(t, a, [{ opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode") }])).rejects.toThrow(/anderer Tab/);
    expect((await t.mutation(api.boardLease.heartbeat, { token, boardId: a.boardId, sessionId: S1, generation: 1 })).ok).toBe(false);
    const ok = await apply(t, { ...a, sessionId: S2, generation: 2 }, [{ opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode") }]);
    expect(ok.results[0].status).toBe("applied");
  });

  test("the holder keeps an expired lease until someone else takes it", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    await t.run(async (ctx) => {
      const board = (await ctx.db.query("boards").collect())[0];
      await ctx.db.patch("boards", board._id, { lease: { ...board.lease!, expiresAt: 1 } });
    });
    const result = await apply(t, a, [{ opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode") }]);
    expect(result.results[0].status).toBe("applied");
    const again = await t.mutation(api.boardLease.acquire, { token, opsVersion: 1, boardId: a.boardId, sessionId: S1, takeover: false });
    expect(again).toMatchObject({ granted: true, generation: 1 });
  });
});

describe("ops", () => {
  test("a retried op is a duplicate and changes nothing; revision grows once per applied op", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    const create = { opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode") };
    const first = await apply(t, a, [create]);
    const second = await apply(t, a, [create]);
    expect(first).toMatchObject({ revision: 1, results: [{ status: "applied", rev: 1, textRev: 1 }] });
    expect(second).toMatchObject({ revision: 1, results: [{ status: "duplicate" }] });
    expect(await nodes(t, a.boardId)).toHaveLength(1);
  });

  test("a stale baseRev is a conflict and applies nothing; a text conflict leaves the server text as it was", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    await apply(t, a, [{ opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode"), text: { blocks: "[]", markdown: "Server" } }]);
    const moved = await apply(t, a, [{ opId: opId(), type: "node.update", nodeId: "text-calm-otter-AAAAA", baseRev: 1, patch: { position: { x: 10, y: 10 } } }]);
    expect(moved.results[0]).toMatchObject({ status: "applied", rev: 2 });
    const stale = await apply(t, a, [{ opId: opId(), type: "node.update", nodeId: "text-calm-otter-AAAAA", baseRev: 1, patch: { position: { x: 99, y: 99 } } }]);
    expect(stale.results[0].status).toBe("conflict");
    expect((await nodes(t, a.boardId))[0].position).toEqual({ x: 10, y: 10 });
    await apply(t, a, [{ opId: opId(), type: "text.set", nodeId: "text-calm-otter-AAAAA", baseTextRev: 1, blocks: "[1]", markdown: "Neu" }]);
    const lost = await apply(t, a, [{ opId: opId(), type: "text.set", nodeId: "text-calm-otter-AAAAA", baseTextRev: 1, blocks: "[2]", markdown: "Lokal" }]);
    expect(lost.results[0].status).toBe("conflict");
    const texts = await t.query(api.boardLoad.getTexts, { token, boardId: a.boardId, nodeIds: ["text-calm-otter-AAAAA"] });
    expect(texts.texts[0]).toEqual({ nodeId: "text-calm-otter-AAAAA", blocks: "[1]", rev: 2 });
  });

  test("an edge needs a source node and a chat, no self edges, no duplicates", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    await apply(t, a, [
      { opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode") },
      { opId: opId(), type: "node.create", node: node("chat-bold-crane-CCCCC", "chatNode") },
    ]);
    const created = await apply(t, a, [{ opId: opId(), type: "edge.create", source: "text-calm-otter-AAAAA", target: "chat-bold-crane-CCCCC" }]);
    expect(created.results[0].status).toBe("applied");
    expect((await apply(t, a, [{ opId: opId(), type: "edge.create", source: "text-calm-otter-AAAAA", target: "chat-bold-crane-CCCCC" }])).results[0].status).toBe("duplicate");
    await expect(apply(t, a, [{ opId: opId(), type: "edge.create", source: "chat-bold-crane-CCCCC", target: "text-calm-otter-AAAAA" }])).rejects.toThrow(/Quelle/);
    await expect(apply(t, a, [{ opId: opId(), type: "edge.create", source: "chat-bold-crane-CCCCC", target: "chat-bold-crane-CCCCC" }])).rejects.toThrow(/sich selbst/);
    expect(await edges(t, a.boardId)).toEqual([edgeId("text-calm-otter-AAAAA", "chat-bold-crane-CCCCC")]);
  });

  test("grouping replaces the children's chat edges by one group edge, dissolving hands them back", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    await apply(t, a, [
      { opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode", 100, 100) },
      { opId: opId(), type: "node.create", node: node("youtube-bold-hawk-BBBBB", "youtubeNode", 100, 500) },
      { opId: opId(), type: "node.create", node: node("chat-bold-crane-CCCCC", "chatNode", 900, 100) },
      { opId: opId(), type: "edge.create", source: "text-calm-otter-AAAAA", target: "chat-bold-crane-CCCCC" },
      { opId: opId(), type: "edge.create", source: "youtube-bold-hawk-BBBBB", target: "chat-bold-crane-CCCCC" },
    ]);
    const group = node("group-keen-owl-GGGGG", "groupNode", 60, 20, { width: 580, height: 806, data: { title: "Gruppe 1" } });
    const grouped = await apply(t, a, [
      { opId: opId(), type: "group.create", group, children: [{ nodeId: "text-calm-otter-AAAAA", baseRev: 1, position: { x: 40, y: 80 } }, { nodeId: "youtube-bold-hawk-BBBBB", baseRev: 1, position: { x: 40, y: 480 } }] },
    ]);
    expect(grouped.results[0].status).toBe("applied");
    expect(await edges(t, a.boardId)).toEqual([edgeId("group-keen-owl-GGGGG", "chat-bold-crane-CCCCC")]);
    const children = (await nodes(t, a.boardId)).filter((n) => n.parentId === "group-keen-owl-GGGGG");
    expect(children.map((c) => c.position)).toEqual([{ x: 40, y: 80 }, { x: 40, y: 480 }]);

    const dissolved = await apply(t, a, [
      { opId: opId(), type: "group.dissolve", groupId: "group-keen-owl-GGGGG", baseRev: 1, children: [{ nodeId: "text-calm-otter-AAAAA", baseRev: 2, position: { x: 100, y: 100 } }, { nodeId: "youtube-bold-hawk-BBBBB", baseRev: 2, position: { x: 100, y: 500 } }] },
    ]);
    expect(dissolved.results[0].status).toBe("applied");
    expect(await edges(t, a.boardId)).toEqual([edgeId("text-calm-otter-AAAAA", "chat-bold-crane-CCCCC"), edgeId("youtube-bold-hawk-BBBBB", "chat-bold-crane-CCCCC")].sort());
    expect((await nodes(t, a.boardId)).every((n) => n.parentId === undefined)).toBe(true);
  });

  test("a conflict in the middle of a grouping leaves no partial change", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    await apply(t, a, [
      { opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode") },
      { opId: opId(), type: "node.create", node: node("text-bold-hawk-BBBBB", "textNode", 0, 400) },
      { opId: opId(), type: "node.create", node: node("chat-bold-crane-CCCCC", "chatNode", 900, 0) },
      { opId: opId(), type: "edge.create", source: "text-calm-otter-AAAAA", target: "chat-bold-crane-CCCCC" },
    ]);
    await apply(t, a, [{ opId: opId(), type: "node.update", nodeId: "text-bold-hawk-BBBBB", baseRev: 1, patch: { position: { x: 5, y: 405 } } }]);
    const revisionBefore = (await t.query(api.boardLoad.getBoard, { token, boardId: a.boardId })).revision;
    const result = await apply(t, a, [
      { opId: opId(), type: "group.create", group: node("group-keen-owl-GGGGG", "groupNode"), children: [{ nodeId: "text-calm-otter-AAAAA", baseRev: 1, position: { x: 40, y: 80 } }, { nodeId: "text-bold-hawk-BBBBB", baseRev: 1, position: { x: 40, y: 480 } }] },
    ]);
    expect(result.results[0].status).toBe("conflict");
    expect(result.revision).toBe(revisionBefore);
    const after = await nodes(t, a.boardId);
    expect(after.map((n) => n.id).sort()).toEqual(["chat-bold-crane-CCCCC", "text-bold-hawk-BBBBB", "text-calm-otter-AAAAA"]);
    expect(after.every((n) => n.parentId === undefined)).toBe(true);
    expect(await edges(t, a.boardId)).toEqual([edgeId("text-calm-otter-AAAAA", "chat-bold-crane-CCCCC")]);
  });

  test("deleting a group cascades to children and edges, undo restores exactly that cascade", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    await apply(t, a, [
      { opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode") },
      { opId: opId(), type: "node.create", node: node("chat-bold-crane-CCCCC", "chatNode", 900, 0) },
      { opId: opId(), type: "group.create", group: node("group-keen-owl-GGGGG", "groupNode"), children: [{ nodeId: "text-calm-otter-AAAAA", baseRev: 1, position: { x: 40, y: 80 } }] },
      { opId: opId(), type: "edge.create", source: "group-keen-owl-GGGGG", target: "chat-bold-crane-CCCCC" },
    ]);
    const deleteOp = opId();
    await apply(t, a, [{ opId: deleteOp, type: "nodes.delete", nodes: [{ nodeId: "group-keen-owl-GGGGG", baseRev: 1 }] }]);
    expect((await nodes(t, a.boardId)).map((n) => n.id)).toEqual(["chat-bold-crane-CCCCC"]);
    expect(await edges(t, a.boardId)).toEqual([]);
    expect((await t.query(api.boardLoad.getBoard, { token, boardId: a.boardId })).nodeCount).toBe(1);
    await apply(t, a, [{ opId: opId(), type: "nodes.restore", deleteOpId: deleteOp }]);
    expect((await nodes(t, a.boardId)).map((n) => n.id).sort()).toEqual(["chat-bold-crane-CCCCC", "group-keen-owl-GGGGG", "text-calm-otter-AAAAA"]);
    expect(await edges(t, a.boardId)).toEqual([edgeId("group-keen-owl-GGGGG", "chat-bold-crane-CCCCC")]);
    expect((await nodes(t, a.boardId)).find((n) => n.id === "text-calm-otter-AAAAA")?.parentId).toBe("group-keen-owl-GGGGG");
  });

  test("IDs from another board abort the whole batch", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t, "long-firefly-Blk7C", S1);
    const b = await setup(t, "calm-otter-XYZ12", S2);
    await apply(t, b, [{ opId: opId(), type: "node.create", node: node("chat-bold-crane-CCCCC", "chatNode") }]);
    await apply(t, a, [{ opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode") }]);
    await expect(
      apply(t, a, [
        { opId: opId(), type: "node.create", node: node("text-quick-fox-DDDDD", "textNode") },
        { opId: opId(), type: "edge.create", source: "text-calm-otter-AAAAA", target: "chat-bold-crane-CCCCC" },
      ]),
    ).rejects.toThrow(/nicht zu diesem Board/);
    expect((await nodes(t, a.boardId)).map((n) => n.id)).toEqual(["text-calm-otter-AAAAA"]);
    await expect(apply(t, a, [{ opId: opId(), type: "node.update", nodeId: "chat-bold-crane-CCCCC", baseRev: 1, patch: { zIndex: 3 } }])).rejects.toThrow(/nicht zu diesem Board/);
  });

  test("groups cannot nest and parentId must point to a group without parent", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    await apply(t, a, [
      { opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode") },
      { opId: opId(), type: "node.create", node: node("group-keen-owl-GGGGG", "groupNode") },
    ]);
    await expect(apply(t, a, [{ opId: opId(), type: "node.create", node: node("group-wise-oak-HHHHH", "groupNode", 0, 0, { parentId: "group-keen-owl-GGGGG" }) }])).rejects.toThrow(/Gruppen/);
    await expect(apply(t, a, [{ opId: opId(), type: "node.create", node: node("text-quick-fox-DDDDD", "textNode", 0, 0, { parentId: "text-calm-otter-AAAAA" }) }])).rejects.toThrow(/Gruppe/);
    await expect(
      apply(t, a, [{ opId: opId(), type: "group.create", group: node("group-wise-oak-HHHHH", "groupNode"), children: [{ nodeId: "group-keen-owl-GGGGG", baseRev: 1, position: { x: 40, y: 80 } }] }]),
    ).rejects.toThrow(/Gruppen/);
    await apply(t, a, [{ opId: opId(), type: "node.create", node: node("text-quick-fox-DDDDD", "textNode", 0, 0, { parentId: "group-keen-owl-GGGGG" }) }]);
    const regroup = await apply(t, a, [{ opId: opId(), type: "group.create", group: node("group-wise-oak-HHHHH", "groupNode"), children: [{ nodeId: "text-quick-fox-DDDDD", baseRev: 1, position: { x: 40, y: 80 } }] }]);
    expect(regroup.results[0].status).toBe("conflict");
  });
});

describe("budgets and loading", () => {
  /** A JSON string of exactly `bytes` UTF-8 bytes built from multi-byte characters. */
  function blocksOfBytes(bytes: number) {
    const fill = bytes - 4; // ["…"]
    const euro = Math.floor(fill / 3);
    return `["${"€".repeat(euro)}${"a".repeat(fill - euro * 3)}"]`;
  }

  test("text budgets hold with Unicode just below and just above the limit", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    const atLimit = blocksOfBytes(LIMITS.blocksBytes);
    expect(new TextEncoder().encode(atLimit).length).toBe(LIMITS.blocksBytes);
    const ok = await apply(t, a, [{ opId: opId(), type: "node.create", node: node("text-calm-otter-AAAAA", "textNode"), text: { blocks: atLimit, markdown: "ä".repeat(LIMITS.markdownBytes / 2) } }]);
    expect(ok.results[0].status).toBe("applied");
    await expect(apply(t, a, [{ opId: opId(), type: "node.create", node: node("text-bold-hawk-BBBBB", "textNode"), text: { blocks: blocksOfBytes(LIMITS.blocksBytes + 1), markdown: "" } }])).rejects.toThrow(/zu groß/);
    await expect(apply(t, a, [{ opId: opId(), type: "text.set", nodeId: "text-calm-otter-AAAAA", baseTextRev: 1, blocks: "[]", markdown: `${"ä".repeat(LIMITS.markdownBytes / 2)}x` }])).rejects.toThrow(/zu groß/);
    const deep = `${"[".repeat(LIMITS.blocksDepth + 1)}${"]".repeat(LIMITS.blocksDepth + 1)}`;
    await expect(apply(t, a, [{ opId: opId(), type: "text.set", nodeId: "text-calm-otter-AAAAA", baseTextRev: 1, blocks: deep, markdown: "" }])).rejects.toThrow(/verschachtelt/);
    await expect(apply(t, a, [{ opId: opId(), type: "node.update", nodeId: "text-calm-otter-AAAAA", baseRev: 1, patch: { data: { notes: "ü".repeat(LIMITS.notesBytes / 2 + 1) } } }])).rejects.toThrow(/Notizen/);
  });

  test("20 maximal texts load in several queries, each at most 8 MB of editor data", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    const blocks = blocksOfBytes(LIMITS.blocksBytes);
    const ids = Array.from({ length: 20 }, (_, i) => `text-calm-otter-${String(i).padStart(5, "0")}`);
    for (let i = 0; i < ids.length; i += 4) {
      const result = await apply(t, a, ids.slice(i, i + 4).map((id) => ({ opId: opId(), type: "node.create", node: node(id, "textNode"), text: { blocks, markdown: "x" } })));
      expect(result.results.every((r: { status: string }) => r.status === "applied")).toBe(true);
    }
    const loaded: string[] = [];
    let pending = ids;
    let queries = 0;
    while (pending.length > 0) {
      const result = await t.query(api.boardLoad.getTexts, { token, boardId: a.boardId, nodeIds: pending });
      const bytes = result.texts.reduce((sum: number, text: { blocks: string }) => sum + new TextEncoder().encode(text.blocks).length, 0);
      expect(bytes).toBeLessThanOrEqual(LIMITS.textQueryBytes);
      expect(result.texts.length).toBeGreaterThan(0);
      loaded.push(...result.texts.map((text: { nodeId: string }) => text.nodeId));
      pending = result.pending;
      queries += 1;
    }
    expect(loaded).toEqual(ids);
    expect(queries).toBe(2);
  });

  test("500 nodes page in chunks of 200 and the 501st is refused", async () => {
    const t = convexTest(schema, modules);
    const a = await setup(t);
    const suffix = (i: number) => i.toString(36).toUpperCase().padStart(5, "0");
    for (let i = 0; i < 500; i += 100) {
      await apply(t, a, Array.from({ length: 100 }, (_, j) => ({ opId: opId(), type: "node.create", node: node(`youtube-bold-hawk-${suffix(i + j)}`, "youtubeNode", (i + j) * 10, 0) })));
    }
    const first = await t.query(api.boardLoad.listNodes, { token, boardId: a.boardId, paginationOpts: { numItems: 1000, cursor: null } });
    expect(first.page).toHaveLength(200);
    expect(await nodes(t, a.boardId)).toHaveLength(500);
    const over = await apply(t, a, [{ opId: opId(), type: "node.create", node: node("youtube-bold-hawk-ZZZZZ", "youtubeNode") }]);
    expect(over.results[0]).toMatchObject({ status: "conflict" });
    expect(over.results[0].reason).toMatch(/500/);
  });
});
