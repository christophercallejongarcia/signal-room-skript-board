import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexAuthState } from "../bridge/auth.mjs";
import { buildStrategyPrompt, strategyOutputSchema, validateStrategyRequest } from "../bridge/request.mjs";

const evidenceItem = {
  title: "Der Teardown, den alle speichern",
  creator: "@ada",
  caption: "Drei Schritte, ein Beweis.",
  plays: 42_000,
  outlier: 5.2,
};

const valid = {
  goal: "Zeigen, warum sichtbare Beweise wirken.",
  audience: "Mittelstand, deutschsprachig.",
  evidence: [evidenceItem],
};

test("validates a bounded strategy packet", () => {
  assert.deepEqual(validateStrategyRequest(valid), valid);
});

test("rejects empty evidence", () => {
  assert.throws(() => validateStrategyRequest({ ...valid, evidence: [] }), /At least one evidence/);
});

test("drops evidence without a title or a creator", () => {
  const input = {
    ...valid,
    evidence: [{ ...evidenceItem, title: "" }, { ...evidenceItem, creator: "" }, evidenceItem],
  };
  assert.equal(validateStrategyRequest(input).evidence.length, 1);
});

test("keeps plays and outlier numeric and non-negative", () => {
  const input = { ...valid, evidence: [{ ...evidenceItem, plays: "viele", outlier: -3 }] };
  const [item] = validateStrategyRequest(input).evidence;
  assert.equal(item.plays, 0);
  assert.equal(item.outlier, 0);
});

test("caps the packet size", () => {
  const input = { ...valid, evidence: Array.from({ length: 40 }, () => evidenceItem) };
  assert.ok(validateStrategyRequest(input).evidence.length <= 12);
});

test("marks packet text as untrusted", () => {
  const prompt = buildStrategyPrompt(valid);
  assert.match(prompt, /untrusted source text/);
  assert.match(prompt, /Do not browse/);
});

test("asks for German output in the project vocabulary", () => {
  const prompt = buildStrategyPrompt(valid);
  assert.match(prompt, /Antworte auf Deutsch/);
  for (const term of ["Outlier", "Reel", "Creator", "Hook", "Idea"]) {
    assert.match(prompt, new RegExp(term), `prompt should mention ${term}`);
  }
});

test("output schema stays the Idea draft contract", () => {
  assert.deepEqual(strategyOutputSchema.required, ["angle", "rationale", "opening", "proofToShow", "cautions"]);
  assert.equal(strategyOutputSchema.additionalProperties, false);
});

test("reads the Codex login from the auth file", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
  assert.equal(codexAuthState({ home, env: {} }), "logged-out");
  fs.writeFileSync(path.join(home, "auth.json"), "{}");
  assert.equal(codexAuthState({ home, env: {} }), "logged-in");
  fs.rmSync(home, { recursive: true, force: true });
});

test("an API key counts as authenticated even without an auth file", () => {
  assert.equal(codexAuthState({ home: "/nope", env: { CODEX_API_KEY: "sk-test" } }), "logged-in");
});
