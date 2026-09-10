import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScriptLintPrompt,
  resolveSlopCheckRoot,
  scriptLintOutputSchema,
  validateScriptLintRequest,
} from "../bridge/request.mjs";

const valid = {
  sections: [
    { id: "section-1", label: "Hook", text: "Die erste Zeile setzt die Richtung." },
    { id: "section-2", label: "Problem", text: "Viele Workflows zeigen nur das Ergebnis und verstecken die Entscheidungen dazwischen." },
  ],
};

test("validates and bounds the Script section packet", () => {
  const request = validateScriptLintRequest({ sections: [{ ...valid.sections[0], text: "x".repeat(2_000) }] });
  assert.equal(request.sections[0].text.length, 1_200);
  assert.deepEqual(validateScriptLintRequest(valid), valid);
  assert.throws(() => validateScriptLintRequest({ sections: [{ ...valid.sections[0] }, { ...valid.sections[0] }] }), /unique/);
  assert.throws(() => validateScriptLintRequest({ sections: [{ ...valid.sections[0], text: "" }] }), /text is required/);
});

test("the Lektorat schema requires bounded reviewable suggestions", () => {
  const schema = scriptLintOutputSchema;
  assert.equal(schema.properties.suggestions.minItems, 0);
  assert.equal(schema.properties.suggestions.maxItems, 20);
  assert.deepEqual(schema.properties.suggestions.items.required, ["sectionId", "original", "replacement", "reason"]);
  assert.equal(schema.additionalProperties, false);
});

test("the Bridge reads the installed .agents skill and carries both Slop stages", () => {
  const root = resolveSlopCheckRoot();
  assert.match(root, /\.agents[\\/]skills[\\/]slop-check$/);
  assert.doesNotMatch(root, /\.Codex[\\/]skills/);
  const prompt = buildScriptLintPrompt(validateScriptLintRequest(valid));
  for (const phrase of ["REGEX-STUFE", "MODELL-STUFE", "SD-28", "Modalpartikeln", "untrusted source text", "Viele Workflows"]) {
    assert.ok(prompt.includes(phrase), `prompt is missing ${phrase}`);
  }
});
