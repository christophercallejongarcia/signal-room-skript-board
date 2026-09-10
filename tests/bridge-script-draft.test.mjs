import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScriptDraftPrompt,
  scriptDraftOutputSchema,
  validateScriptDraftRequest,
} from "../bridge/request.mjs";

const valid = {
  goal: "Eine prüfbare Regel zeigen.",
  audience: "Deutschsprachige Creator.",
  idea: { title: "Sichtbare Belege statt Behauptungen" },
  source: {
    id: "source-1",
    title: "Ein echter Ausgangspunkt",
    creator: "@studio",
    caption: "Ein Beleg vor der Behauptung.",
    plays: 120_000,
    outlier: 4.2,
    transcript: "Erst die Szene, dann die Erklärung.",
  },
  evidence: [{
    id: "evidence-1",
    title: "Der Beleg vor der Behauptung",
    creator: "@fieldnotes",
    caption: "Zeig, was die Aussage trägt.",
    plays: 90_000,
    outlier: 3.1,
    transcript: "Die Reihenfolge verändert, was das Publikum glaubt.",
  }],
  frameworks: [
    { id: "pas", label: "PAS", definition: "Problem, Agitation, Solution", useWhen: "Bei einem klaren Engpass" },
    { id: "bbb", label: "BBB", definition: "Before, Bridge, After", useWhen: "Bei einer sichtbaren Veränderung" },
    { id: "none", label: "Keins", definition: "Kein festes Framework", useWhen: "Wenn die natürliche Reihenfolge trägt" },
  ],
  selectedHook: {
    hook: "Drei sichtbare Schritte reichen für einen prüfbaren Agenten-Ablauf.",
    angle: "Der Ablauf wird an sichtbaren Entscheidungen erklärt.",
  },
  framework: "pas",
};

test("validates the Draft packet with selected Hook, Angle and framework", () => {
  assert.deepEqual(validateScriptDraftRequest(valid), valid);
  assert.throws(() => validateScriptDraftRequest({ ...valid, selectedHook: { ...valid.selectedHook, hook: "" } }), /selectedHook.hook is required/);
  assert.throws(() => validateScriptDraftRequest({ ...valid, framework: "story" }), /framework must be/);
});

test("the Draft schema requires one ordered section list with bounded kinds", () => {
  const schema = scriptDraftOutputSchema;
  assert.deepEqual(schema.required, ["sections"]);
  assert.equal(schema.properties.sections.minItems, 4);
  assert.ok(schema.properties.sections.maxItems >= 8);
  assert.deepEqual(schema.properties.sections.items.properties.kind.enum, ["hook", "beat", "transition", "cta"]);
  assert.deepEqual(schema.properties.sections.items.required, ["kind", "label", "text"]);
  assert.equal(schema.additionalProperties, false);
});

test("the Draft prompt preserves the selected Hook and the editorial trust boundary", () => {
  const prompt = buildScriptDraftPrompt(validateScriptDraftRequest(valid));
  for (const phrase of [
    "copy the selected Hook verbatim",
    "two to five Beats",
    "Do not copy wording",
    "Antworte auf Deutsch",
    "untrusted source text",
  ]) {
    assert.ok(prompt.includes(phrase), `prompt is missing ${phrase}`);
  }
  assert.ok(prompt.includes(valid.selectedHook.hook));
  assert.ok(prompt.includes(valid.source.transcript));
});
