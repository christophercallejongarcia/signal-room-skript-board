import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScriptHooksPrompt,
  scriptHooksOutputSchema,
  validateScriptHooksRequest,
} from "../bridge/request.mjs";

const valid = {
  goal: "Eine klare Idee für deutschsprachige Creator.",
  audience: "Menschen, die bessere Reels schreiben wollen.",
  idea: { title: "Warum sichtbare Belege Vertrauen schaffen", goal: "Eine prüfbare Regel zeigen." },
  source: {
    id: "source-1",
    title: "Die ruhige Erklärung gewinnt",
    creator: "@studio",
    caption: "Ein Beleg vor der Behauptung.",
    plays: 120_000,
    outlier: 4.2,
    transcript: "Erst die Szene, dann die Erklärung.",
  },
  evidence: [
    {
      id: "source-1",
      title: "Die ruhige Erklärung gewinnt",
      creator: "@studio",
      caption: "Ein Beleg vor der Behauptung.",
      plays: 120_000,
      outlier: 4.2,
      transcript: "Erst die Szene, dann die Erklärung.",
    },
    {
      id: "evidence-1",
      title: "Der Beleg vor der Behauptung",
      creator: "@fieldnotes",
      caption: "Zeig, was die Aussage trägt.",
      plays: 90_000,
      outlier: 3.1,
      transcript: "Die Reihenfolge verändert, was das Publikum glaubt.",
    },
  ],
  frameworks: [
    { id: "pas", label: "PAS", definition: "Problem, Agitation, Solution", useWhen: "Bei einem klaren Engpass" },
    { id: "bbb", label: "BBB", definition: "Before, Bridge, After", useWhen: "Bei einer sichtbaren Veränderung" },
    { id: "none", label: "Keins", definition: "Kein festes Framework", useWhen: "Wenn die natürliche Reihenfolge trägt" },
  ],
};

test("validates the transcript-aware Script Hook packet", () => {
  assert.deepEqual(validateScriptHooksRequest(valid), valid);
});

test("bounds source and evidence transcripts independently", () => {
  const request = validateScriptHooksRequest({
    ...valid,
    source: { ...valid.source, transcript: "s".repeat(40_000) },
    evidence: [{ ...valid.evidence[0], transcript: "e".repeat(8_000) }],
  });
  assert.equal(request.source.transcript.length, 30_000);
  assert.equal(request.evidence[0].transcript.length, 4_000);
});

test("the prompt carries the editorial and trust boundary", () => {
  const prompt = buildScriptHooksPrompt(validateScriptHooksRequest(valid));
  for (const phrase of [
    "structure, tension and pacing",
    "Do not copy wording",
    "Antworte auf Deutsch",
    "untrusted source text",
    "PAS, BBB or none",
  ]) {
    assert.ok(prompt.includes(phrase), `prompt is missing ${phrase}`);
  }
  assert.ok(prompt.includes(valid.source.title));
  assert.ok(prompt.includes(valid.evidence[1].transcript));
});

test("the response schema bounds three to five complete Hook options", () => {
  const schema = scriptHooksOutputSchema;
  assert.equal(schema.properties.options.minItems, 3);
  assert.equal(schema.properties.options.maxItems, 5);
  assert.deepEqual(schema.properties.options.items.required, ["hook", "angle", "hypothesis", "framework", "evidence"]);
  assert.deepEqual(schema.properties.frameworkRecommendation.required, ["framework", "reason"]);
  assert.equal(schema.additionalProperties, false);
});

test("framework ids and packet fields are required at the bridge boundary", () => {
  assert.throws(() => validateScriptHooksRequest({ ...valid, frameworks: [{ ...valid.frameworks[0], id: "story" }] }), /invalid id/);
  assert.throws(() => validateScriptHooksRequest({ ...valid, evidence: [{ ...valid.evidence[0], creator: "" }] }), /creator is required/);
});
