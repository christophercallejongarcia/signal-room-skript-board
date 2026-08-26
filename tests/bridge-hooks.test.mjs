import test from "node:test";
import assert from "node:assert/strict";
import { buildHooksPrompt, hooksOutputSchema, validateHooksRequest } from "../bridge/request.mjs";

const evidenceItem = {
  title: "Nie wieder Meetings ohne Protokoll",
  creator: "@bruno",
  caption: "Nie wieder Meetings ohne Protokoll. Der Agent schreibt mit.",
  plays: 80_000,
  outlier: 3.4,
};

const valid = {
  goal: "Ein Reel, das den Beweis zeigt.",
  audience: "Mittelstand, deutschsprachig.",
  source: "Transkript: wir haben das Protokoll automatisiert.",
  direction: "Für Agenturen.",
  count: 10,
  evidence: [evidenceItem],
};

test("validates a bounded hooks packet", () => {
  assert.deepEqual(validateHooksRequest(valid), valid);
});

test("the source is required", () => {
  assert.throws(() => validateHooksRequest({ ...valid, source: "   " }), /source is required/);
});

test("the direction is optional and dropped when empty", () => {
  const request = validateHooksRequest({ ...valid, direction: "  " });
  assert.equal(request.direction, undefined);
  assert.equal("direction" in request, false);
});

test("the count is snapped onto one of the three the app can ask for", () => {
  assert.equal(validateHooksRequest({ ...valid, count: 999 }).count, 15);
  assert.equal(validateHooksRequest({ ...valid, count: 0 }).count, 5);
  assert.equal(validateHooksRequest({ ...valid, count: 7 }).count, 5);
  assert.equal(validateHooksRequest({ ...valid, count: 13 }).count, 15);
  assert.equal(validateHooksRequest({ ...valid, count: undefined }).count, 5);
});

test("the source is cut at the bridge ceiling", () => {
  const request = validateHooksRequest({ ...valid, source: "a".repeat(60_000) });
  assert.ok(request.source.length < 60_000);
});

test("hook runs need evidence like every other route", () => {
  assert.throws(() => validateHooksRequest({ ...valid, evidence: [] }), /At least one evidence/);
});

test("the prompt names the hypotheses and carries the packet", () => {
  const prompt = buildHooksPrompt(validateHooksRequest(valid));
  for (const hypothesis of ["curiosity", "list", "contrast", "promise", "story"]) {
    assert.ok(prompt.includes(hypothesis), `prompt is missing ${hypothesis}`);
  }
  assert.ok(prompt.includes("Nie wieder Meetings ohne Protokoll"));
  assert.ok(prompt.includes("10"));
});

test("the schema forces a hypothesis out of the five and evidence titles", () => {
  const item = hooksOutputSchema(10).properties.hooks.items;
  assert.deepEqual(item.properties.hypothesis.enum, ["curiosity", "list", "contrast", "promise", "story"]);
  assert.deepEqual(item.required, ["hook", "hypothesis", "rationale", "evidence"]);
  assert.equal(hooksOutputSchema(10).additionalProperties, false);
});

test("the schema asks for exactly the requested number of hooks", () => {
  for (const count of [5, 10, 15]) {
    const hooks = hooksOutputSchema(count).properties.hooks;
    assert.equal(hooks.minItems, count);
    assert.equal(hooks.maxItems, count);
  }
});
