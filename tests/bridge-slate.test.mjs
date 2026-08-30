import test from "node:test";
import assert from "node:assert/strict";
import { buildSlatePrompt, slateOutputSchema, validateSlateRequest } from "../bridge/request.mjs";

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
  count: 10,
  evidence: [evidenceItem, { ...evidenceItem, title: "Die besten drei Agenten", creator: "@ada" }],
};

test("a slate run is the strategy packet plus the count; direction and taken are optional", () => {
  assert.deepEqual(validateSlateRequest(valid), valid);
  const full = validateSlateRequest({ ...valid, count: 1, direction: " mehr Werkzeug ", taken: ["Startpunkt eins", 7, "   "] });
  assert.equal(full.count, 1);
  assert.equal(full.direction, "mehr Werkzeug");
  assert.deepEqual(full.taken, ["Startpunkt eins"]);
});

test("the count is a whole number from 1 to 10", () => {
  assert.throws(() => validateSlateRequest({ ...valid, count: 0 }), /count must be/);
  assert.throws(() => validateSlateRequest({ ...valid, count: 11 }), /count must be/);
  assert.throws(() => validateSlateRequest({ ...valid, count: 2.5 }), /count must be/);
  assert.throws(() => validateSlateRequest({ ...valid, count: "10" }), /count must be/);
});

test("a slate without a single reel is refused", () => {
  assert.throws(() => validateSlateRequest({ ...valid, evidence: [] }), /At least one evidence/);
});

test("the answer holds exactly count starts, each pointing at a packet position", () => {
  const schema = slateOutputSchema(3, 2);
  const starts = schema.properties.starts;
  assert.equal(starts.minItems, 3);
  assert.equal(starts.maxItems, 3);
  assert.deepEqual(starts.items.required, ["pitch", "topic", "source"]);
  assert.equal(starts.items.properties.source.type, "integer");
  assert.equal(starts.items.properties.source.minimum, 1);
  assert.equal(starts.items.properties.source.maximum, 2);
  assert.equal(starts.items.additionalProperties, false);
  assert.deepEqual(schema.required, ["starts"]);
});

test("the prompt names the count, the direction, the taken starts and carries the packet", () => {
  const prompt = buildSlatePrompt(validateSlateRequest({ ...valid, count: 1, direction: "mehr Werkzeug", taken: ["Startpunkt eins"] }));
  assert.match(prompt, /exactly 1 starting point/);
  assert.match(prompt, /mehr Werkzeug/);
  assert.match(prompt, /Startpunkt eins/);
  assert.match(prompt, /Nie wieder Meetings ohne Protokoll/);
  assert.match(prompt, /untrusted source text/);
  // Positions are how a start names its Reel, so the prompt has to spell them out.
  assert.match(prompt, /1\. @bruno/);
  assert.match(prompt, /2\. @ada/);
});
