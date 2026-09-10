import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTranscriptCorrectionsPrompt,
  transcriptCorrectionsOutputSchema,
  validateTranscriptCorrectionsRequest,
} from "../bridge/request.mjs";

const valid = {
  transcript: "Chris zeigt Notion.",
  creator: "@chris",
  caption: "Ein kurzer Test.",
};

test("validates a bounded transcript-correction packet", () => {
  assert.deepEqual(validateTranscriptCorrectionsRequest(valid), valid);
  const parsed = validateTranscriptCorrectionsRequest({ ...valid, dictionary: [{ wrong: "Notion", right: "Notion AI" }] });
  assert.deepEqual(parsed.dictionary, [{ wrong: "Notion", right: "Notion AI" }]);
});

test("the correction request requires original transcript and Creator", () => {
  assert.throws(() => validateTranscriptCorrectionsRequest({ ...valid, transcript: " " }), /transcript is required/);
  assert.throws(() => validateTranscriptCorrectionsRequest({ ...valid, creator: " " }), /creator is required/);
});

test("the correction prompt forbids rewriting and carries the source packet", () => {
  const prompt = buildTranscriptCorrectionsPrompt(validateTranscriptCorrectionsRequest({
    ...valid,
    dictionary: [{ wrong: "Notion", right: "Notion AI" }],
  }));
  assert.match(prompt, /recognition errors only/i);
  assert.match(prompt, /Do not rewrite/i);
  assert.match(prompt, /Notion/);
  assert.match(prompt, /Notion AI/);
  assert.match(prompt, /@chris/);
});

test("the output schema is a bounded fixed corrections list", () => {
  assert.deepEqual(transcriptCorrectionsOutputSchema.required, ["corrections"]);
  assert.equal(transcriptCorrectionsOutputSchema.additionalProperties, false);
  const item = transcriptCorrectionsOutputSchema.properties.corrections.items;
  assert.deepEqual(item.required, ["original", "replacement", "reason"]);
  assert.equal(item.additionalProperties, false);
  assert.equal(transcriptCorrectionsOutputSchema.properties.corrections.maxItems, 20);
});
