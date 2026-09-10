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

const validScript = {
  ...valid,
  script: {
    id: "script-approved",
    revision: 7,
    sections: [
      { kind: "hook", label: "Hook", text: "Ein gutes Briefing trifft zuerst eine Entscheidung." },
      { kind: "beat", label: "Problem", text: "Material ohne Richtung erzeugt Schleifen." },
      { kind: "beat", label: "Regel", text: "Eine Auswahl hält den Beleg klein." },
      { kind: "cta", label: "CTA", text: "Prüfe dein nächstes Briefing." },
    ],
  },
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

test("the second Storyboard input form carries one bounded approved Script", () => {
  assert.deepEqual(validateStoryboardRequest(validScript), validScript);
  assert.throws(
    () => validateStoryboardRequest({ ...validScript, script: { ...validScript.script, sections: [] } }),
    /script.sections/,
  );
  assert.throws(
    () => validateStoryboardRequest({ ...validScript, script: { ...validScript.script, sections: validScript.script.sections.filter((section) => section.kind !== "cta") } }),
    /exactly one CTA/,
  );
  assert.throws(
    () => validateStoryboardRequest({ ...validScript, script: { ...validScript.script, sections: validScript.script.sections.filter((section) => section.kind !== "beat") } }),
    /two to five Beats/,
  );
});

test("the Script Storyboard prompt asks for three derived beats and a literal Script Hook", () => {
  const prompt = buildStoryboardPrompt(validateStoryboardRequest(validScript));
  assert.match(prompt, /approved Script/);
  assert.match(prompt, /exactly three/);
  assert.match(prompt, /Hook.*verbatim/i);
  assert.match(prompt, /Ein gutes Briefing trifft zuerst eine Entscheidung/);
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
  assert.deepEqual(storyboardOutputSchema.required, ["hook", "beats", "cta", "caption", "takeaway", "forecast"]);
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

test("the storyboard schema asks for a forecast with comparable titles, risk and tension", () => {
  const forecast = storyboardOutputSchema.properties.forecast;
  assert.deepEqual(forecast.required, ["comparable", "risk", "tension"]);
  assert.equal(forecast.properties.comparable.items.type, "string");
  assert.equal(forecast.additionalProperties, false);
});

test("the storyboard prompt asks for the forecast without a self-estimated reach", () => {
  const prompt = buildStoryboardPrompt(validateStoryboardRequest(valid));
  assert.match(prompt, /forecast\.comparable/);
  assert.match(prompt, /Do not estimate reach yourself/);
  assert.match(prompt, /an empty list is a valid answer/);
});
