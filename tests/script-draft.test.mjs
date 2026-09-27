import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SCRIPT_COPY_SENTENCE_MIN_WORDS } from "../lib/config.ts";
import { parseScriptDraftAnswer, ScriptCopyError } from "../lib/script-draft.ts";
import { runScriptDraft, ScriptDraftConflictError } from "../lib/script-draft-run.ts";
import { claimScriptRun, newScript, settleScriptRun } from "../lib/scripts.ts";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const actorFixture = JSON.parse(await readFile(new URL("./fixtures/apify-transcript-items.json", import.meta.url), "utf8"));
const selectedHook = "Drei sichtbare Schritte reichen für einen prüfbaren Agenten-Ablauf.";

function draftRequest(overrides = {}) {
  return {
    goal: "Eine prüfbare Regel zeigen.",
    audience: "Deutschsprachige Creator.",
    idea: { title: "Sichtbare Belege statt Behauptungen" },
    source: {
      id: "source-1",
      title: "Ein echter Ausgangspunkt",
      creator: "@studio",
      caption: actorFixture[0].title,
      plays: 120_000,
      outlier: 4.2,
      transcript: actorFixture[0].text,
    },
    evidence: [{
      id: "evidence-1",
      title: "Der Beleg vor der Behauptung",
      creator: "@fieldnotes",
      caption: "Zeig den sichtbaren Zwischenschritt vor dem Ergebnis.",
      plays: 90_000,
      outlier: 3.1,
      transcript: "Die Reihenfolge verändert, was das Publikum glaubt.",
    }],
    frameworks: [
      { id: "pas", label: "PAS", definition: "Problem, Agitation, Solution", useWhen: "Bei einem klaren Engpass" },
      { id: "bbb", label: "BBB", definition: "Before, Bridge, After", useWhen: "Bei einer sichtbaren Veränderung" },
      { id: "none", label: "Keins", definition: "Kein festes Framework", useWhen: "Wenn die natürliche Reihenfolge trägt" },
    ],
    selectedHook: { hook: selectedHook, angle: "Der Ablauf wird an sichtbaren Entscheidungen erklärt." },
    framework: "pas",
    ...overrides,
  };
}

function answer(beat = "Zeige zuerst den Input und benenne dann die konkrete Entscheidung.") {
  return {
    sections: [
      { kind: "hook", label: "Hook", text: selectedHook },
      { kind: "beat", label: "Ausgangslage", text: beat },
      { kind: "transition", label: "Übergang", text: "Dann wird der unsichtbare Teil des Ablaufs konkret." },
      { kind: "beat", label: "Beleg", text: "Lege einen Zwischenstand offen und erkläre die Abbruchregel." },
      { kind: "cta", label: "CTA", text: "Prüfe deinen nächsten Ablauf auf einen sichtbaren Zwischenschritt." },
    ],
  };
}

test("rejects a copied eight-word sentence from the transcript fixture and names it", () => {
  assert.equal(SCRIPT_COPY_SENTENCE_MIN_WORDS, 8);
  const copied = "Erstmal öffne ChatGPT und gib diesen Prompt ein.";
  assert.throws(
    () => parseScriptDraftAnswer(answer(copied), draftRequest()),
    (error) => error?.name === "ScriptCopyError" && error.message.includes(`\"${copied}\"`),
  );
});

test("rejects a changed Hook and accepts a complete original section list", () => {
  assert.throws(
    () => parseScriptDraftAnswer({ ...answer(), sections: [{ kind: "hook", label: "Hook", text: "Ein anderer Hook." }, ...answer().sections.slice(1)] }, draftRequest()),
    /Hook section must match the selected Hook verbatim/,
  );
  assert.throws(
    () => parseScriptDraftAnswer({ ...answer(), sections: [{ kind: "hook", label: "Hook", text: ` ${selectedHook}` }, ...answer().sections.slice(1)] }, draftRequest()),
    /Hook section must match the selected Hook verbatim/,
  );
  assert.throws(
    () => parseScriptDraftAnswer({ sections: [answer().sections.at(-1), ...answer().sections.slice(1, -1), answer().sections[0]] }, draftRequest()),
    /start with the Hook and end with the CTA/,
  );
  const parsed = parseScriptDraftAnswer(answer(), draftRequest());
  assert.deepEqual(parsed.sections, answer().sections);
  assert.equal(parsed.sections[0].text, selectedHook);
});

test("an abbreviation cannot split a copied sentence below the eight-word boundary", () => {
  const copied = "Das gilt z. B. für jeden einzelnen neuen Entwurf heute.";
  const request = draftRequest({
    source: { ...draftRequest().source, transcript: copied },
    evidence: [],
  });
  assert.throws(() => parseScriptDraftAnswer(answer(copied), request), ScriptCopyError);
});

function idea() {
  return {
    id: "idea-1",
    title: "Sichtbare Belege statt Behauptungen",
    goal: "Eine prüfbare Regel zeigen.",
    status: "developing",
    sourceSignalId: "source-1",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function signal(id, overrides = {}) {
  return {
    id,
    creatorId: "creator-1",
    title: `Signal ${id}`,
    publishedAt: "2026-08-30T12:00:00.000Z",
    views: 100_000,
    plays: 100_000,
    likes: 1_000,
    comments: 100,
    format: "reel",
    caption: `Caption ${id}`,
    transcript: `Eigenständiges Transkript ${id}.`,
    ...overrides,
  };
}

function script(overrides = {}) {
  return {
    ...newScript({ ideaId: "idea-1", sourceSignalId: "source-1", evidenceSignalIds: ["evidence-1"] }, { id: "script-1", now: NOW.toISOString() }),
    framework: "pas",
    hookOptions: [{
      id: "hook-1",
      hook: selectedHook,
      angle: "Der Ablauf wird an sichtbaren Entscheidungen erklärt.",
      hypothesis: "Ein konkreter Ablauf hält die Aufmerksamkeit.",
      framework: "pas",
      evidence: [],
      edited: false,
    }],
    selectedHookId: "hook-1",
    ...overrides,
  };
}

function fakeStorage(initialScript = script()) {
  const state = {
    script: initialScript,
    ideas: [idea()],
    signals: [signal("source-1"), signal("evidence-1")],
    creators: [{ id: "creator-1", name: "Studio", handle: "@studio", network: "instagram", audience: 1_000, accent: "#ff6546" }],
    claimOptions: undefined,
  };
  return {
    state,
    async getScript(id) { return state.script.id === id ? state.script : null; },
    async listIdeas() { return state.ideas; },
    async listSignals() { return state.signals; },
    async listCreators() { return state.creators; },
    async claimScriptRun(id, runId, now, options) {
      if (state.script.id !== id) return null;
      state.claimOptions = options;
      state.script = claimScriptRun(state.script, runId, now, options);
      return state.script;
    },
    async settleScriptRun(id, runId, result) {
      if (state.script.id !== id) return null;
      const settled = settleScriptRun(state.script, runId, result);
      if (settled) state.script = settled;
      return settled;
    },
  };
}

function deps(storage, bridge) {
  return {
    storage,
    bridge,
    now: () => NOW,
    createId: (prefix) => `${prefix}-1`,
    demo: false,
  };
}

test("Draft run conflicts outside Hook-Selection and Draft without calling the Bridge", async () => {
  const storage = fakeStorage(script({ status: "review", sections: answer().sections, revision: 1 }));
  let called = false;
  await assert.rejects(
    runScriptDraft("script-1", { selectedHookId: "hook-1", framework: "pas" }, deps(storage, async () => { called = true; return answer(); })),
    ScriptDraftConflictError,
  );
  assert.equal(called, false);
  assert.equal(storage.state.script.runId, undefined);
});

test("first and second Draft runs replace all sections and advance one revision each", async () => {
  const storage = fakeStorage();
  const first = await runScriptDraft("script-1", { selectedHookId: "hook-1", framework: "bbb" }, deps(storage, async () => answer("Der erste eigenständige Beat erklärt eine konkrete Entscheidung.")));
  assert.equal(first.script.status, "draft");
  assert.equal(first.script.revision, 1);
  assert.equal(first.script.framework, "bbb");
  assert.equal(first.script.selectedHookId, "hook-1");
  assert.deepEqual(storage.state.claimOptions, { rejectIfRunning: true });

  const second = await runScriptDraft("script-1", { selectedHookId: "hook-1", framework: "pas" }, deps(storage, async () => answer("Der zweite Entwurf ersetzt den alten Beat vollständig.")));
  assert.equal(second.script.revision, 2);
  assert.equal(second.script.sections[1].text, "Der zweite Entwurf ersetzt den alten Beat vollständig.");
  assert.ok(!second.script.sections.some((section) => section.text.includes("erste eigenständige")));
});

test("a failed Draft run releases its claim and demo mode returns a fixed draft", async () => {
  const storage = fakeStorage();
  await assert.rejects(
    runScriptDraft("script-1", { selectedHookId: "hook-1", framework: "pas" }, deps(storage, async () => { throw new Error("bridge down"); })),
    /bridge down/,
  );
  assert.equal(storage.state.script.runId, undefined);
  const demo = await runScriptDraft("script-1", { selectedHookId: "hook-1", framework: "pas" }, { ...deps(storage, async () => { throw new Error("must not call"); }), demo: true });
  assert.equal(demo.script.status, "draft");
  assert.equal(demo.script.sections[0].text, selectedHook);
});
