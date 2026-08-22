import assert from "node:assert/strict";
import test from "node:test";
import { buildStrategyPrompt, validateStrategyRequest } from "../bridge/request.mjs";

const valid = {
  goal: "Explain why visible evidence matters.",
  audience: "Small technical teams.",
  evidence: [{ title: "Research systems should show receipts", topic: "evidence systems", score: 71 }],
};

test("validates a bounded strategy packet", () => {
  assert.deepEqual(validateStrategyRequest(valid), valid);
});

test("rejects empty evidence", () => {
  assert.throws(() => validateStrategyRequest({ ...valid, evidence: [] }), /At least one evidence/);
});

test("marks packet text as untrusted", () => {
  const prompt = buildStrategyPrompt(valid);
  assert.match(prompt, /untrusted source text/);
  assert.match(prompt, /Do not browse/);
});
