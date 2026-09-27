/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const token = "t".repeat(64);

beforeEach(() => {
  vi.stubEnv("BOARD_ACCESS_TOKEN", token);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

test("board health reports schema, ops versions and mode, only with the right token", async () => {
  const t = convexTest(schema, modules);
  const health = await t.query(api.board.boardHealth, { token });
  expect(health).toMatchObject({ ok: true, layer: "convex", schemaVersion: 1, supportedOpsVersions: [1], mode: "open", restoreEpoch: 1 });
  await expect(t.query(api.board.boardHealth, { token: "f".repeat(64) })).rejects.toThrow(/verweigert/);
  await expect(t.query(api.board.boardHealth, { token: "" })).rejects.toThrow(/verweigert/);
});

test("without BOARD_ACCESS_TOKEN in the deployment every board call fails closed", async () => {
  vi.stubEnv("BOARD_ACCESS_TOKEN", "");
  const t = convexTest(schema, modules);
  await expect(t.query(api.board.boardHealth, { token: "" })).rejects.toThrow(/verweigert/);
  await expect(t.query(api.boards.list, { token })).rejects.toThrow(/verweigert/);
});

test("a write with an unsupported opsVersion is rejected before anything is stored", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.boards.create, { token, opsVersion: 0, id: "long-firefly-Blk7C", title: "Alt" })).rejects.toThrow(/neu laden/);
  expect(await t.query(api.boards.list, { token })).toEqual([]);
});

test("readonly blocks new writes and keeps reads; draining blocks new work; restoring blocks everything", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.boards.create, { token, opsVersion: 1, id: "long-firefly-Blk7C", title: "Kupfernes Kaninchen" });
  await t.mutation(internal.boardAdmin.setMode, { mode: "readonly" });
  await expect(t.mutation(api.boards.create, { token, opsVersion: 1, id: "calm-otter-AB3de", title: "Neu" })).rejects.toThrow(/schreibgeschützt/);
  expect(await t.query(api.boards.list, { token })).toHaveLength(1);
  await t.mutation(internal.boardAdmin.setMode, { mode: "draining" });
  await expect(t.mutation(api.boards.create, { token, opsVersion: 1, id: "calm-otter-AB3de", title: "Neu" })).rejects.toThrow(/Drain/);
  const restoring = await t.mutation(internal.boardAdmin.setMode, { mode: "restoring" });
  expect(restoring.restoreEpoch).toBe(2);
  await expect(t.mutation(api.boards.create, { token, opsVersion: 1, id: "calm-otter-AB3de", title: "Neu" })).rejects.toThrow(/wiederhergestellt/);
  await t.mutation(internal.boardAdmin.setMode, { mode: "open" });
  expect((await t.query(api.board.boardHealth, { token })).restoreEpoch).toBe(2);
  expect((await t.mutation(api.boards.create, { token, opsVersion: 1, id: "calm-otter-AB3de", title: "Neu" })).created).toBe(true);
});

test("create is idempotent on the board id and validates id and title", async () => {
  const t = convexTest(schema, modules);
  expect(await t.mutation(api.boards.create, { token, opsVersion: 1, id: "long-firefly-Blk7C", title: " Kupfernes Kaninchen " })).toEqual({ id: "long-firefly-Blk7C", created: true });
  expect(await t.mutation(api.boards.create, { token, opsVersion: 1, id: "long-firefly-Blk7C", title: "Anders" })).toEqual({ id: "long-firefly-Blk7C", created: false });
  expect((await t.query(api.boards.list, { token }))[0].title).toBe("Kupfernes Kaninchen");
  await expect(t.mutation(api.boards.create, { token, opsVersion: 1, id: "../etc", title: "x" })).rejects.toThrow(/Board-ID/);
  await expect(t.mutation(api.boards.create, { token, opsVersion: 1, id: "calm-otter-AB3de", title: "   " })).rejects.toThrow(/Titel/);
});

test("the doctor write probe leaves nothing behind", async () => {
  const t = convexTest(schema, modules);
  expect(await t.mutation(internal.boardAdmin.writeProbe, { probeId: "p1" })).toEqual({ wrote: true, deleted: true });
  const rows = await t.run(async (ctx) => ctx.db.query("boardConfig").collect());
  expect(rows).toEqual([]);
});
