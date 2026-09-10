import test from "node:test";
import assert from "node:assert/strict";
import { newScript } from "../lib/scripts.ts";
import {
  applyScriptLintSuggestion,
  parseScriptLintResponse,
  scriptLintSections,
  scriptSectionId,
} from "../lib/script-lint.ts";
import { runScriptLint, ScriptLintConflictError } from "../lib/script-lint-run.ts";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const sections = [
  { kind: "hook", label: "Hook", text: "Die erste Zeile setzt die Richtung." },
  { kind: "beat", label: "Problem", text: "Viele Workflows zeigen nur das Ergebnis und verstecken die Entscheidungen dazwischen." },
  { kind: "beat", label: "Beleg", text: "Zeige den Input und den nächsten sichtbaren Schritt." },
  { kind: "cta", label: "CTA", text: "Prüfe den Ablauf beim nächsten Beitrag." },
];

function script(overrides = {}) {
  return {
    ...newScript({ ideaId: "idea-1" }, { id: "script-1", now: NOW.toISOString() }),
    status: "draft",
    sections,
    revision: 1,
    ...overrides,
  };
}

function fakeStorage(initial = script()) {
  const state = { script: initial };
  let claimOptions;
  return {
    state,
    get claimOptions() { return claimOptions; },
    async getScript() { return state.script; },
    async claimScriptRun(_id, runId, now, options) {
      claimOptions = options;
      if (state.script.runId) throw new ScriptLintConflictError();
      state.script = { ...state.script, runId, updatedAt: now };
      return state.script;
    },
    async settleScriptRun(_id, runId, result) {
      if (state.script.runId !== runId) return null;
      const { runId: _runId, ...withoutRun } = state.script;
      state.script = { ...withoutRun, updatedAt: result.now };
      return state.script;
    },
  };
}

test("the Lektorat parser drops unknown sections, missing occurrences and duplicates", () => {
  const parsed = parseScriptLintResponse({
    suggestions: [
      { sectionId: "section-2", original: "Viele Workflows", replacement: "Workflows", reason: "Kürzer." },
      { sectionId: "section-2", original: "Viele Workflows", replacement: "Viele Abläufe", reason: "Doppelt." },
      { sectionId: "section-2", original: "nicht im Abschnitt", replacement: "x", reason: "Fällt weg." },
      { sectionId: "section-99", original: "Viele Workflows", replacement: "x", reason: "Fällt weg." },
    ],
  }, scriptLintSections({ sections }));
  assert.deepEqual(parsed, [{ sectionId: "section-2", original: "Viele Workflows", replacement: "Workflows", reason: "Kürzer." }]);
});

test("the Lektorat parser caps the list and every returned line", () => {
  const words = Array.from({ length: 25 }, (_, index) => `Wort${index}`);
  const sourceSections = [{ ...sections[0], text: words.join(" ") }, ...sections.slice(1)];
  const parsed = parseScriptLintResponse({
    suggestions: words.map((word) => ({
      sectionId: "section-1",
      original: word,
      replacement: `${word} neu`,
      reason: "r".repeat(400),
    })),
  }, scriptLintSections({ sections: sourceSections }));
  assert.equal(parsed.length, 20);
  assert.equal(parsed[0].reason.length, 240);

  const long = "x".repeat(200);
  const bounded = parseScriptLintResponse({ suggestions: [{ sectionId: "section-1", original: long, replacement: "neu", reason: "Grund" }] }, [
    { id: "section-1", label: "Hook", text: `${long} bleibt.` },
  ]);
  assert.equal(bounded[0].original.length, 120);
});

test("a human acceptance replaces the literal text and advances the revision once", () => {
  const current = script();
  const suggestion = { sectionId: scriptSectionId(1), original: "Viele Workflows", replacement: "Workflows", reason: "Kürzer." };
  const updated = applyScriptLintSuggestion(current, suggestion, "2026-09-01T12:05:00.000Z");
  assert.equal(updated.sections[1].text, "Workflows zeigen nur das Ergebnis und verstecken die Entscheidungen dazwischen.");
  assert.equal(updated.sections[0].text, current.sections[0].text);
  assert.equal(updated.revision, current.revision + 1);
});

test("a successful Lektorat run claims the Script, sends sections and leaves text untouched", async () => {
  const storage = fakeStorage();
  let request;
  const result = await runScriptLint("script-1", {
    storage,
    now: () => NOW,
    createId: (prefix) => `${prefix}-1`,
    bridge: async (input) => {
      request = input;
      return { suggestions: [{ sectionId: "section-2", original: "Viele Workflows", replacement: "Workflows", reason: "Kürzer." }] };
    },
  });
  assert.deepEqual(request.sections.map((section) => section.id), ["section-1", "section-2", "section-3", "section-4"]);
  assert.equal(result.script.runId, undefined);
  assert.equal(result.script.revision, 1);
  assert.equal(result.suggestions.length, 1);
  assert.deepEqual(storage.claimOptions, { rejectIfRunning: true });
  assert.equal(storage.state.script.sections[1].text, sections[1].text);
});

test("a second click conflicts and a Bridge error releases the claim for retry", async () => {
  const locked = fakeStorage(script({ runId: "other-run" }));
  let called = false;
  await assert.rejects(runScriptLint("script-1", { storage: locked, bridge: async () => { called = true; return {}; } }), ScriptLintConflictError);
  assert.equal(called, false);

  const storage = fakeStorage();
  await assert.rejects(
    runScriptLint("script-1", { storage, now: () => NOW, bridge: async () => { throw new Error("bridge down"); } }),
    /bridge down/,
  );
  assert.equal(storage.state.script.runId, undefined);
  const retry = await runScriptLint("script-1", {
    storage,
    now: () => NOW,
    bridge: async () => ({ suggestions: [] }),
  });
  assert.deepEqual(retry.suggestions, []);
});

test("demo mode returns fixed suggestions without calling the Bridge", async () => {
  const storage = fakeStorage();
  const result = await runScriptLint("script-1", {
    storage,
    now: () => NOW,
    demo: true,
    bridge: async () => { throw new Error("must not call"); },
  });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].sectionId, "section-2");
});
