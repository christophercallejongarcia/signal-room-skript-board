import test from "node:test";
import assert from "node:assert/strict";
import { BoardSession } from "../lib/board/board-session.ts";
import { connectCommand, createNodeCommand, deleteCommand, groupCommand, moveCommand, UndoStack, ungroupCommand } from "../lib/board/commands.ts";
import { edgeId } from "../lib/board/ids.ts";
import { confirmsVersion, journalKey, MemoryJournal, textKey } from "../lib/board/journal.ts";
import { applyOpLocal, modelFrom } from "../lib/board/model.ts";
import { BACKOFF_MS, OpQueue, TEXT_DEBOUNCE_MS } from "../lib/board/op-queue.ts";
import { chatNode, FakeLocks, FakeServer, ManualClock, settle, textNode } from "./helpers/board-fakes.mjs";

const T1 = "text-calm-otter-AAAAA";
const T2 = "text-bold-hawk-BBBBB";
const C1 = "chat-bold-crane-CCCCC";

function applyAll(model, ops) {
  return ops.reduce((current, op) => applyOpLocal(current, op), model);
}

test("grouping moves children into the group and replaces their chat edges; dissolving hands them back", () => {
  let model = modelFrom([textNode(T1, 100, 100), textNode(T2, 100, 500), chatNode(C1)], []);
  model = applyAll(model, connectCommand(model, T1, C1).ops);
  model = applyAll(model, connectCommand(model, T2, C1).ops);
  const grouped = groupCommand(model, [T1, T2]);
  model = applyAll(model, grouped.ops);
  const groupId = grouped.ops[0].group.id;
  assert.equal(model.nodes.get(T1).parentId, groupId);
  assert.deepEqual(model.nodes.get(T1).position, { x: 40, y: 80 });
  assert.deepEqual([...model.edges.keys()], [edgeId(groupId, C1)]);
  assert.equal(model.nodes.get(groupId).data.title, "Gruppe 1");
  model = applyAll(model, ungroupCommand(model, groupId).ops);
  assert.equal(model.nodes.has(groupId), false);
  assert.deepEqual(model.nodes.get(T1).position, { x: 100, y: 100 });
  assert.deepEqual([...model.edges.keys()].sort(), [edgeId(T1, C1), edgeId(T2, C1)].sort());
});

test("connect refuses invalid, self and duplicate edges", () => {
  let model = modelFrom([textNode(T1), textNode(T2), chatNode(C1)], []);
  assert.equal(connectCommand(model, T1, T2).ops.length, 0);
  assert.equal(connectCommand(model, C1, T1).ops.length, 0);
  assert.equal(connectCommand(model, C1, C1).ops.length, 0);
  model = applyAll(model, connectCommand(model, T1, C1).ops);
  assert.equal(connectCommand(model, T1, C1).ops.length, 0);
});

test("undo and redo produce ops with current revisions: create, delete, move, group", () => {
  const stack = new UndoStack(50);
  let model = modelFrom([textNode(T1, 0, 0), chatNode(C1)], []);
  const run = (command) => {
    model = applyAll(model, command.ops);
    if (command.undo) stack.push(command.undo);
  };
  run(moveCommand(model, [{ id: T1, from: { x: 0, y: 0 }, to: { x: 50, y: 50 } }]));
  run(deleteCommand(model, [T1]));
  assert.equal(model.nodes.has(T1), false);
  model = applyAll(model, stack.undo(model));
  assert.equal(model.nodes.has(T1), true, "undo after delete restores");
  model = applyAll(model, stack.undo(model));
  assert.deepEqual(model.nodes.get(T1).position, { x: 0, y: 0 });
  const redo = stack.redo(model);
  assert.equal(redo[0].baseRev, model.nodes.get(T1).rev, "redo carries the current rev");
  model = applyAll(model, redo);
  assert.deepEqual(model.nodes.get(T1).position, { x: 50, y: 50 });

  run(createNodeCommand({ id: T2, type: "textNode", position: { x: 0, y: 0 }, width: 500, height: 300, zIndex: 1, data: { title: "" } }));
  run(groupCommand(model, [T1, T2]));
  const group = [...model.nodes.values()].find((n) => n.type === "groupNode");
  model = applyAll(model, stack.undo(model));
  assert.equal(model.nodes.has(group.id), false);
  model = applyAll(model, stack.redo(model));
  const regrouped = [...model.nodes.values()].find((n) => n.type === "groupNode");
  assert.ok(regrouped && regrouped.id !== group.id, "redo builds a fresh group");
  assert.equal(model.nodes.get(T1).parentId, regrouped.id);

  const small = new UndoStack(3);
  for (let i = 0; i < 5; i += 1) small.push({ label: String(i), undo: () => [], redo: () => [] });
  assert.equal(small.depth, 3);
});

test("the queue debounces text for 400 ms, sends in order and retries with 1, 2, 5, 10 s", async () => {
  const clock = new ManualClock();
  const sent = [];
  let failures = 5;
  const queue = new OpQueue({
    clock,
    async send(ops) {
      if (failures > 0) {
        failures -= 1;
        sent.push({ at: clock.now(), failed: true });
        throw { kind: "offline", message: "offline" };
      }
      sent.push({ at: clock.now(), ops: ops.map((op) => op.opId) });
      return { revision: 1, results: ops.map((op) => ({ opId: op.opId, status: "applied" })) };
    },
    onResults() {},
    onFatal() {},
    onTextDue: (nodeId) => [{ opId: `op-text-${nodeId}`, type: "text.set", nodeId, baseTextRev: 1, blocks: "[]", markdown: "x" }],
  });
  queue.touchText("n1");
  await clock.advance(200);
  queue.touchText("n1");
  await clock.advance(TEXT_DEBOUNCE_MS - 1);
  assert.equal(sent.length, 0, "debounce restarts on every change");
  await clock.advance(1);
  assert.equal(sent.length, 1);
  queue.enqueue({ opId: "op-after", type: "edge.delete", edgeId: "xy-edge__x" });
  const start = sent[0].at;
  await clock.advance(BACKOFF_MS.reduce((a, b) => a + b, 0) + 10_000);
  const attempts = sent.map((entry) => entry.at - start);
  assert.deepEqual(attempts.slice(0, 6), [0, 1_000, 3_000, 8_000, 18_000, 28_000]);
  assert.deepEqual(sent.at(-1).ops, ["op-text-n1", "op-after"], "order kept, retried batch first");
  assert.equal(queue.currentStatus, "saved");
});

test("flush fires pending debounces and resolves only when everything is confirmed", async () => {
  const clock = new ManualClock();
  let release;
  const queue = new OpQueue({
    clock,
    send: (ops) => new Promise((resolve) => (release = () => resolve({ revision: 1, results: ops.map((op) => ({ opId: op.opId, status: "applied" })) }))),
    onResults() {},
    onFatal() {},
    onTextDue: (nodeId) => [{ opId: `op-${nodeId}`, type: "text.set", nodeId, baseTextRev: 0, blocks: "[]", markdown: "" }],
  });
  queue.touchText("n1");
  let done = false;
  const flushed = queue.flush().then(() => (done = true));
  await settle();
  assert.equal(done, false);
  release();
  await flushed;
  assert.equal(done, true);
});

test("journal: a confirmation deletes only the confirmed version, never a newer one", async () => {
  const journal = new MemoryJournal();
  const scope = { deploymentId: "anonymous:x", boardId: "long-firefly-Blk7C", editorSessionId: "session-aaaa1111" };
  const base = { ...scope, entryKey: textKey(T1), kind: "text", nodeId: T1, blocks: "[]", markdown: "", baseTextRev: 1, opsVersion: 1, restoreEpoch: 1, leaseSessionId: "s", leaseGeneration: 1, updatedAt: 0 };
  await journal.put({ ...base, localVersion: 1 });
  await journal.put({ ...base, localVersion: 2, markdown: "neuer" });
  assert.equal(await journal.confirm(journalKey(base), confirmsVersion(1)), false, "late confirmation of version 1");
  assert.equal((await journal.listBoard(scope.deploymentId, scope.boardId))[0].markdown, "neuer");
  assert.equal(await journal.confirm(journalKey(base), confirmsVersion(2)), true);
  assert.deepEqual(await journal.listBoard(scope.deploymentId, scope.boardId), []);
  assert.deepEqual(journalKey(base), ["anonymous:x", "long-firefly-Blk7C", "session-aaaa1111", `text:${T1}`]);
  await journal.put({ ...base, boardId: "calm-otter-XYZ12", localVersion: 3 });
  assert.equal((await journal.listBoard(scope.deploymentId, scope.boardId)).length, 0, "other boards stay apart");
});

function session({ server, journal = new MemoryJournal(), locks = new FakeLocks(), clock = new ManualClock(), editorSessionId = "session-aaaa1111" }) {
  return new BoardSession({ boardId: "long-firefly-Blk7C", deploymentId: "anonymous:x", editorSessionId, transport: server.transport(), journal, locks, clock });
}

test("session: journal before network; a failing local write stops sending and turns the board read-only", async () => {
  const server = new FakeServer([textNode(T1), chatNode(C1)]);
  const journal = new MemoryJournal();
  const clock = new ManualClock();
  const board = session({ server, journal, clock });
  await board.open();
  assert.equal(board.writable, true);
  journal.failWrites = true;
  const ok = await board.run(connectCommand(board.model, T1, C1));
  assert.equal(ok, false);
  await clock.advance(1_000);
  assert.equal(server.calls.length, 0, "nothing reached the network");
  assert.equal(board.saveState, "localfail");
  assert.equal(board.writable, false);
  assert.match(board.notice, /Lokale Sicherung fehlgeschlagen/);
});

test("session: text is journaled per keystroke, saved after the debounce, and the entry disappears once confirmed", async () => {
  const server = new FakeServer([textNode(T1)]);
  const journal = new MemoryJournal();
  const clock = new ManualClock();
  const board = session({ server, journal, clock });
  await board.open();
  await board.setText(T1, '["a"]', "a");
  await board.setText(T1, '["ab"]', "ab");
  assert.equal(journal.entries.size, 1, "one text entry, overwritten");
  await clock.advance(TEXT_DEBOUNCE_MS);
  assert.equal(server.texts.get(T1).markdown, "ab");
  assert.equal(journal.entries.size, 0);
  assert.equal(board.saveState, "saved");
});

test("session: offline text survives a reload of the same tab and is saved once the server is back", async () => {
  const server = new FakeServer([textNode(T1)]);
  const journal = new MemoryJournal();
  const clock = new ManualClock();
  const first = session({ server, journal, clock });
  await first.open();
  server.offline = true;
  const big = "ü".repeat(60 * 1024);
  await first.setText(T1, JSON.stringify([big]), big);
  await clock.advance(TEXT_DEBOUNCE_MS + 5_000);
  assert.equal(first.saveState, "offline");
  assert.equal(journal.entries.size, 1);
  first.close();

  const reloaded = session({ server, journal, clock });
  await reloaded.open();
  server.offline = false;
  await clock.advance(20_000);
  assert.equal(server.texts.get(T1)?.markdown, big);
  assert.equal(journal.entries.size, 0);
});

test("session: a closed tab's entries are adopted when its lease is still the current one", async () => {
  const server = new FakeServer([textNode(T1)]);
  const journal = new MemoryJournal();
  const clock = new ManualClock();
  const locks = new FakeLocks();
  const first = session({ server, journal, clock, locks, editorSessionId: "session-aaaa1111" });
  await first.open();
  server.offline = true;
  await first.setText(T1, '["weg"]', "weg");
  locks.alive.clear();
  server.offline = false;
  const second = session({ server, journal, clock, locks, editorSessionId: "session-bbbb2222" });
  await second.open();
  await clock.advance(5_000);
  assert.equal(server.texts.get(T1).markdown, "weg");
  assert.equal(second.offers.length, 0);
});

test("session: A→B→A with competing text edits ends in a conflict copy, nothing is lost", async () => {
  const server = new FakeServer([textNode(T1)]);
  const journal = new MemoryJournal();
  const clock = new ManualClock();
  const locks = new FakeLocks();
  const a = session({ server, journal, clock, locks, editorSessionId: "session-aaaa1111" });
  await a.open();
  server.offline = true;
  await a.setText(T1, '["von A"]', "von A");
  await clock.advance(TEXT_DEBOUNCE_MS);
  server.offline = false;
  const b = session({ server, journal, clock, locks, editorSessionId: "session-bbbb2222" });
  await b.open();
  assert.equal(b.writable, false, "A is alive, B opens read-only");
  await b.takeOver();
  assert.equal(b.writable, true);
  await b.setText(T1, '["von B"]', "von B");
  await clock.advance(TEXT_DEBOUNCE_MS + 100);
  assert.equal(server.texts.get(T1).markdown, "von B");
  await clock.advance(5_000);
  assert.equal(a.writable, false, "A lost the lease when its retry hit B's generation");
  await a.takeOver();
  await clock.advance(1_000);
  const copies = [...server.model.nodes.values()].filter((node) => node.data.title.startsWith("Konfliktkopie"));
  assert.equal(copies.length, 1);
  assert.equal(server.texts.get(copies[0].id).markdown, "von A");
  assert.equal(server.texts.get(T1).markdown, "von B");
  assert.equal(a.saveState, "conflict");
});

test("session: with both tabs alive, B's takeover shows A's open entries only as an offer", async () => {
  const server = new FakeServer([textNode(T1)]);
  const journal = new MemoryJournal();
  const clock = new ManualClock();
  const locks = new FakeLocks();
  const a = session({ server, journal, clock, locks, editorSessionId: "session-aaaa1111" });
  await a.open();
  server.offline = true;
  await a.setText(T1, '["offen"]', "offen");
  server.offline = false;
  const b = session({ server, journal, clock, locks, editorSessionId: "session-bbbb2222" });
  await b.open();
  assert.equal(b.offers.length, 1);
  await b.takeOver();
  await clock.advance(2_000);
  assert.notEqual(server.texts.get(T1)?.markdown, "offen", "not applied without a click");
  await b.acceptOffers();
  await clock.advance(2_000);
  const copy = [...server.model.nodes.values()].find((node) => node.data.title.startsWith("Konfliktkopie"));
  assert.equal(server.texts.get(copy.id).markdown, "offen");
});
