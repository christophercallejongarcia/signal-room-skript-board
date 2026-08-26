import test from "node:test";
import assert from "node:assert/strict";
import { parseCreatorMark } from "../lib/creator-mark.ts";

test("parseCreatorMark reads either mark on its own", () => {
  assert.deepEqual(parseCreatorMark({ id: "instagram-mine", owned: true }), { id: "instagram-mine", owned: true });
  assert.deepEqual(parseCreatorMark({ id: "instagram-x", foreign: false }), { id: "instagram-x", foreign: false });
  assert.deepEqual(parseCreatorMark({ id: " x ", owned: false, foreign: true }), { id: "x", owned: false, foreign: true });
});

test("parseCreatorMark rejects a missing id, a missing mark and a non-boolean mark", () => {
  assert.throws(() => parseCreatorMark({ owned: true }), /id required/);
  assert.throws(() => parseCreatorMark({ id: "x" }), /owned or foreign required/);
  assert.throws(() => parseCreatorMark({ id: "x", owned: "yes" }), /owned must be true or false/);
  assert.throws(() => parseCreatorMark({ id: "x", foreign: 1 }), /foreign must be true or false/);
  assert.throws(() => parseCreatorMark(null), /id required/);
  assert.throws(() => parseCreatorMark(undefined), /id required/);
  assert.throws(() => parseCreatorMark({ id: "   ", owned: true }), /id required/);
  assert.throws(() => parseCreatorMark({ id: 7, foreign: true }), /id required/);
});
