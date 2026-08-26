import test from "node:test";
import assert from "node:assert/strict";
import { briefingOutputSchema, buildBriefingPrompt, validateBriefingRequest } from "../bridge/request.mjs";

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
  evidence: [evidenceItem, { ...evidenceItem, title: "Die besten drei Agenten", creator: "@ada" }],
};

test("a briefing run is the strategy packet: goal, audience, the ranked reels", () => {
  assert.deepEqual(validateBriefingRequest(valid), valid);
});

test("a briefing without a single reel is refused", () => {
  assert.throws(() => validateBriefingRequest({ ...valid, evidence: [] }), /At least one evidence/);
});

test("the answer holds exactly one angle per reel", () => {
  const schema = briefingOutputSchema(2);
  assert.equal(schema.properties.angles.minItems, 2);
  assert.equal(schema.properties.angles.maxItems, 2);
  assert.equal(schema.properties.angles.items.type, "string");
  assert.deepEqual(schema.required, ["angles"]);
  assert.equal(schema.additionalProperties, false);
});

test("the prompt names the order the angles come back in, and carries the packet", () => {
  const prompt = buildBriefingPrompt(validateBriefingRequest(valid));
  assert.match(prompt, /exactly 2 angles/);
  assert.match(prompt, /same order/);
  assert.match(prompt, /Nie wieder Meetings ohne Protokoll/);
  assert.match(prompt, /untrusted source text/);
});
