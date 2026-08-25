import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStoryboardPrompt,
  storyboardOutputSchema,
  validateStoryboardRequest,
} from "../bridge/request.mjs";

const evidenceItem = {
  title: "Der Teardown, den alle speichern",
  creator: "@ada",
  caption: "Drei Schritte, ein Beweis.",
  plays: 42_000,
  outlier: 5.2,
};

const valid = {
  goal: "Ein Reel, das den Beweis zeigt.",
  audience: "Mittelstand, deutschsprachig.",
  idea: { title: "Warum Outlier lügen", goal: "Der Zuschauer prüft seine eigenen Zahlen." },
  evidence: [evidenceItem],
};

test("validates a bounded storyboard packet", () => {
  assert.deepEqual(validateStoryboardRequest(valid), valid);
});

test("the idea title is required", () => {
  assert.throws(() => validateStoryboardRequest({ ...valid, idea: { title: "  " } }), /idea.title is required/);
  assert.throws(() => validateStoryboardRequest({ ...valid, idea: undefined }), /idea.title is required/);
});

test("the idea goal is optional and dropped when empty", () => {
  const request = validateStoryboardRequest({ ...valid, idea: { title: "Nur ein Titel", goal: "   " } });
  assert.deepEqual(request.idea, { title: "Nur ein Titel" });
});

test("storyboard runs need evidence like strategy runs", () => {
  assert.throws(() => validateStoryboardRequest({ ...valid, evidence: [] }), /At least one evidence/);
});

test("storyboard runs bound goal, audience and evidence the same way", () => {
  const request = validateStoryboardRequest({
    ...valid,
    idea: { title: "t".repeat(1_000), goal: "g".repeat(4_000) },
    evidence: Array.from({ length: 40 }, () => evidenceItem),
  });
  assert.ok(request.idea.title.length <= 300);
  assert.ok(request.idea.goal.length <= 1_200);
  assert.ok(request.evidence.length <= 12);
});

test("the storyboard schema asks for hook, three beats, cta, caption and takeaway", () => {
  assert.deepEqual(storyboardOutputSchema.required, ["hook", "beats", "cta", "caption", "takeaway"]);
  assert.equal(storyboardOutputSchema.properties.beats.minItems, 3);
  assert.equal(storyboardOutputSchema.properties.beats.maxItems, 3);
  assert.deepEqual(storyboardOutputSchema.properties.beats.items.required, ["label", "detail"]);
  assert.equal(storyboardOutputSchema.additionalProperties, false);
});

test("the storyboard prompt marks packet text as untrusted", () => {
  const prompt = buildStoryboardPrompt(valid);
  assert.match(prompt, /untrusted source text/);
  assert.match(prompt, /Do not browse/);
});

test("the storyboard prompt asks for German in the project vocabulary", () => {
  const prompt = buildStoryboardPrompt(valid);
  assert.match(prompt, /Antworte auf Deutsch/);
  for (const term of ["Outlier", "Reel", "Hook", "Idea", "Storyboard"]) {
    assert.match(prompt, new RegExp(term));
  }
});

test("the storyboard prompt carries the idea and the evidence", () => {
  const prompt = buildStoryboardPrompt(valid);
  assert.match(prompt, /Warum Outlier lügen/);
  assert.match(prompt, /Der Teardown, den alle speichern/);
});
