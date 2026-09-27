import test from "node:test";
import assert from "node:assert/strict";
import { BOARD_ID_PATTERN, edgeId, isNodeId, newBoardId, newBoardTitle, newNodeId, nodeTypeOfId } from "../lib/board/ids.ts";
import { decideLease, LEASE_MS, leaseAllowsWrite } from "../lib/board/lease.ts";
import { assertTextBudget, jsonDepth, LIMITS, previewOf, TextTooLargeError, truncateUtf8, utf8Bytes } from "../lib/board/limits.ts";
import { connectionVerdict, dissolveGeometry, groupGeometry, OpValidationError, validateOp, validateOps } from "../lib/board/ops.ts";

function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("IDs follow Poppy's scheme and carry their node type", () => {
  const board = newBoardId(seq([0.1, 0.5, 0.2, 0.3, 0.4, 0.5, 0.6]));
  assert.match(board, BOARD_ID_PATTERN);
  for (const type of ["youtubeNode", "textNode", "groupNode", "chatNode"]) {
    const id = newNodeId(type);
    assert.ok(isNodeId(id), id);
    assert.equal(nodeTypeOfId(id), type);
  }
  assert.equal(edgeId("text-a-b-CCCCC", "chat-d-e-FFFFF"), "xy-edge__text-a-b-CCCCCconnector-chat-d-e-FFFFFchat-connector");
  assert.match(newBoardTitle(), /^\S+ \S+$/);
  assert.equal(isNodeId("text-a-b-CCCC"), false);
  assert.equal(isNodeId("../../etc"), false);
});

test("byte budgets count UTF-8 bytes and JSON depth ignores brackets in strings", () => {
  assert.equal(utf8Bytes("ä€😀"), 2 + 3 + 4);
  assert.equal(jsonDepth('[{"a":[1]}]'), 3);
  assert.equal(jsonDepth('["[[[[{{{", "\\"]]]"]'), 1);
  assert.throws(() => assertTextBudget({ blocks: "x".repeat(LIMITS.blocksBytes + 1), markdown: "" }), TextTooLargeError);
  assert.deepEqual(assertTextBudget({ blocks: "[]", markdown: "äb" }), { blocksBytes: 2, textBytes: 3 });
  assert.equal(previewOf("a\n\n b" + "😀".repeat(600)).length <= 2 + 1 + 2 + 500 * 2, true);
  assert.equal(Array.from(previewOf("😀".repeat(600))).length, 500);
  const cut = truncateUtf8("ab😀c", 5);
  assert.deepEqual(cut, { text: "ab", truncated: true });
});

test("edge rules: sources to chat only, handles fixed, no self edges", () => {
  assert.equal(connectionVerdict("textNode", "chatNode", "t", "c"), null);
  assert.equal(connectionVerdict("groupNode", "chatNode", "g", "c"), null);
  assert.equal(connectionVerdict("youtubeNode", "chatNode", "y", "c"), null);
  assert.match(connectionVerdict("chatNode", "chatNode", "c1", "c2"), /Quelle/);
  assert.match(connectionVerdict("textNode", "textNode", "t1", "t2"), /Chat/);
  assert.match(connectionVerdict("textNode", "chatNode", "x", "x"), /selbst/);
  assert.match(connectionVerdict("textNode", "chatNode", "t", "c", "connector", "other"), /Anschlüsse/);
});

test("group geometry wraps the children with the Poppy padding and dissolve restores absolute positions", () => {
  const children = [
    { id: "a", position: { x: 100, y: 100 }, width: 500, height: 300 },
    { id: "b", position: { x: 100, y: 500 }, width: 290, height: 206 },
  ];
  const geometry = groupGeometry(children);
  assert.deepEqual(geometry.position, { x: 60, y: 20 });
  assert.deepEqual(geometry.childPositions.a, { x: 40, y: 80 });
  assert.deepEqual(geometry.childPositions.b, { x: 40, y: 480 });
  assert.equal(geometry.width, 580);
  assert.equal(geometry.height, 606 + 120);
  const back = dissolveGeometry({ position: geometry.position }, [{ id: "a", position: geometry.childPositions.a }, { id: "b", position: geometry.childPositions.b }]);
  assert.deepEqual(back, { a: { x: 100, y: 100 }, b: { x: 100, y: 500 } });
});

test("op validation rejects foreign shapes before Convex sees them", () => {
  const text = { id: "text-calm-otter-AAAAA", type: "textNode", position: { x: 0, y: 0 }, width: 500, height: 300, zIndex: 1, data: { title: "" } };
  assert.equal(validateOp({ opId: "op-000001", type: "node.create", node: text }).type, "node.create");
  const bad = [
    { opId: "x", type: "node.create", node: text },
    { opId: "op-000001", type: "node.create", node: { ...text, type: "chatNode" } },
    { opId: "op-000001", type: "node.create", node: { ...text, data: { title: "", evil: 1 } } },
    { opId: "op-000001", type: "node.create", node: { ...text, position: { x: Number.NaN, y: 0 } } },
    { opId: "op-000001", type: "node.create", node: { ...text, id: "group-calm-otter-AAAAA", type: "groupNode", parentId: "group-keen-owl-GGGGG" } },
    { opId: "op-000001", type: "node.update", nodeId: text.id, baseRev: 1, patch: {} },
    { opId: "op-000001", type: "node.update", nodeId: text.id, baseRev: -1, patch: { zIndex: 1 } },
    { opId: "op-000001", type: "edge.create", source: "chat-bold-crane-CCCCC", target: text.id },
    { opId: "op-000001", type: "text.set", nodeId: "chat-bold-crane-CCCCC", baseTextRev: 0, blocks: "[]", markdown: "" },
    { opId: "op-000001", type: "node.create", node: { ...text, id: "youtube-bold-hawk-BBBBB", type: "youtubeNode", data: { title: "", url: "https://evil.example/watch?v=AAAAAAAAAAA" } } },
    { opId: "op-000001", type: "board.update", patch: { videoSlug: "../etc" } },
    { opId: "op-000001", type: "rm -rf" },
  ];
  for (const op of bad) assert.throws(() => validateOp(op), OpValidationError, JSON.stringify(op).slice(0, 80));
  assert.throws(() => validateOps([]), OpValidationError);
  assert.throws(() => validateOps(Array.from({ length: LIMITS.opsPerBatch + 1 }, () => ({ opId: "op-000001", type: "edge.delete", edgeId: "xy-edge__a" }))), /Höchstens/);
});

test("lease: renew for the holder, deny others unless they take over, generation grows on takeover", () => {
  const now = 1_000_000;
  const first = decideLease(undefined, { sessionId: "A", now, takeover: false, restoreEpoch: 1 });
  assert.equal(first.action, "grant");
  assert.equal(first.lease.generation, 1);
  assert.equal(decideLease(first.lease, { sessionId: "A", now: now + 1, takeover: false, restoreEpoch: 1 }).action, "renew");
  assert.equal(decideLease(first.lease, { sessionId: "B", now: now + 1, takeover: false, restoreEpoch: 1 }).action, "deny");
  const taken = decideLease(first.lease, { sessionId: "B", now: now + 1, takeover: true, restoreEpoch: 1 });
  assert.equal(taken.lease.generation, 2);
  const expired = decideLease(first.lease, { sessionId: "B", now: now + LEASE_MS + 1, takeover: false, restoreEpoch: 1 });
  assert.equal(expired.action, "grant");
  assert.equal(leaseAllowsWrite(first.lease, "A", 1), true);
  assert.equal(leaseAllowsWrite(taken.lease, "A", 1), false);
  assert.equal(decideLease(first.lease, { sessionId: "A", now, takeover: false, restoreEpoch: 2 }).lease.generation, 2, "a new restore epoch never renews an old lease");
});
