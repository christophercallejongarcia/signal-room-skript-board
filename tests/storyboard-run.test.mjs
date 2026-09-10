import test from "node:test";
import assert from "node:assert/strict";
import { runScriptStoryboard, StoryboardConflictError } from "../lib/storyboard-run.ts";
import { claimScriptRun, settleScriptRun } from "../lib/scripts.ts";
import { isLegacyStoryboard, isStoryboardOutdated } from "../lib/storyboard.ts";

const NOW = "2026-09-10T09:00:00.000Z";
const legacyStoryboard = {
  hook: "Alter Hook",
  beats: [
    { label: "Alt 1", detail: "Altes Detail eins." },
    { label: "Alt 2", detail: "Altes Detail zwei." },
    { label: "Alt 3", detail: "Altes Detail drei." },
  ],
  cta: "Alte CTA.",
  caption: "Alte Caption.",
  takeaway: "Alter Takeaway.",
};
const approvedScript = {
  id: "script-1",
  ideaId: "idea-1",
  sourceSignalId: "signal-1",
  evidenceSignalIds: ["signal-2"],
  status: "approved",
  framework: "none",
  frameworkReason: "",
  hookOptions: [],
  sections: [
    { kind: "hook", label: "Hook", text: "Ein gutes Briefing trifft zuerst eine Entscheidung." },
    { kind: "beat", label: "Problem", text: "Material ohne Richtung erzeugt neue Schleifen." },
    { kind: "beat", label: "Regel", text: "Eine klare Auswahl hält die Arbeit klein." },
    { kind: "cta", label: "CTA", text: "Prüfe dein Briefing auf eine Entscheidung." },
  ],
  revision: 3,
  approvedRevision: 3,
  approvedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};
const idea = {
  id: "idea-1",
  title: "Briefings ohne Schleifen",
  status: "developing",
  storyboard: legacyStoryboard,
  createdAt: NOW,
  updatedAt: NOW,
};
const creators = [
  { id: "creator-1", name: "Eins", handle: "@eins", network: "instagram", audience: 1_000, accent: "#000" },
  { id: "creator-2", name: "Zwei", handle: "@zwei", network: "instagram", audience: 2_000, accent: "#111" },
];
const signals = [
  { id: "signal-1", creatorId: "creator-1", title: "Beleg eins", caption: "Erster Beleg", format: "reel", publishedAt: NOW, views: 5_000, plays: 5_000, likes: 1, comments: 1, durationSeconds: 20, thumbnailSeed: "one", topic: "briefing" },
  { id: "signal-2", creatorId: "creator-2", title: "Beleg zwei", caption: "Zweiter Beleg", format: "reel", publishedAt: NOW, views: 8_000, plays: 8_000, likes: 1, comments: 1, durationSeconds: 20, thumbnailSeed: "two", topic: "briefing" },
];
const answer = {
  hook: "Wird deterministisch ersetzt.",
  beats: [
    { label: "Richtung", detail: "Lege das Ziel vor der Materialsammlung fest." },
    { label: "Auswahl", detail: "Behalte nur Belege für diese eine Entscheidung." },
    { label: "Prüfung", detail: "Streiche jeden Rest vor der ersten Revision." },
  ],
  cta: "Prüfe dein nächstes Briefing vor dem Versand.",
  caption: "Eine Entscheidung führt.\nDie Belege machen sie sichtbar.",
  takeaway: "Der Zuschauer kann sein Briefing kürzen.",
  forecast: { comparable: ["Erster Beleg", "Zweiter Beleg"], risk: "Die Regel bleibt zu abstrakt.", tension: "Welche Auswahl verhindert die nächste Schleife?" },
};

function fakeStorage(script = approvedScript) {
  const state = { script: structuredClone(script), idea: structuredClone(idea), saved: 0 };
  return {
    state,
    storage: {
      async getScript(id) { return id === state.script.id ? structuredClone(state.script) : null; },
      async getIdea(id) { return id === state.idea.id ? structuredClone(state.idea) : null; },
      async listIdeas() { throw new Error("Storyboard runs must not scan Ideas"); },
      async listSignals() { return structuredClone(signals); },
      async listCreators() { return structuredClone(creators); },
      async saveIdea() { throw new Error("Storyboard runs must not replace a whole Idea"); },
      async saveIdeaStoryboard(id, storyboard, options) {
        if (id !== state.idea.id) return null;
        const { forecast: _previousForecast, ...current } = state.idea;
        state.idea = {
          ...current,
          storyboard: structuredClone(storyboard),
          ...(options.forecast ? { forecast: structuredClone(options.forecast) } : {}),
          developedAt: options.now,
          evidenceCount: options.evidenceCount,
          updatedAt: options.now,
        };
        state.saved += 1;
        return structuredClone(state.idea);
      },
      async claimScriptRun(id, runId, now, options) {
        if (id !== state.script.id) return null;
        state.script = claimScriptRun(state.script, runId, now, options);
        return structuredClone(state.script);
      },
      async settleScriptRun(id, runId, result) {
        if (id !== state.script.id) return null;
        const settled = settleScriptRun(state.script, runId, result);
        if (settled) state.script = settled;
        return settled ? structuredClone(settled) : null;
      },
    },
  };
}

test("a Storyboard run refuses every Script stage except approved", async () => {
  for (const script of [
    { ...approvedScript, status: "hook-selection", approvedRevision: undefined },
    { ...approvedScript, status: "draft", approvedRevision: undefined },
    { ...approvedScript, status: "review", approvedRevision: undefined },
    { ...approvedScript, revision: 4, approvedRevision: 3 },
  ]) {
    const { storage, state } = fakeStorage(script);
    let bridgeCalls = 0;
    await assert.rejects(
      runScriptStoryboard("script-1", { storage, bridge: async () => { bridgeCalls += 1; return answer; }, now: () => new Date(NOW) }),
      StoryboardConflictError,
    );
    assert.equal(bridgeCalls, 0);
    assert.equal(state.saved, 0);
  }
});

test("an approved Script replaces a Legacy Storyboard and keeps its evidence Forecast", async () => {
  const { storage, state } = fakeStorage();
  assert.equal(isLegacyStoryboard(state.idea.storyboard), true);
  const result = await runScriptStoryboard("script-1", { storage, bridge: async () => answer, now: () => new Date(NOW) });
  assert.equal(result.idea.storyboard.scriptId, "script-1");
  assert.equal(result.idea.storyboard.scriptRevision, 3);
  assert.equal(result.idea.storyboard.hook, approvedScript.sections[0].text);
  assert.deepEqual(result.idea.forecast.range, { low: 5_000, high: 8_000 });
  assert.equal(isLegacyStoryboard(result.idea.storyboard), false);
  assert.equal(state.saved, 1);
  assert.equal(state.script.runId, undefined);
});

test("a Storyboard becomes stale after a newer Script revision is approved", async () => {
  const { storage } = fakeStorage();
  const result = await runScriptStoryboard("script-1", { storage, bridge: async () => answer, now: () => new Date(NOW) });
  assert.equal(isStoryboardOutdated(result.idea.storyboard, approvedScript), false);
  assert.equal(isStoryboardOutdated(result.idea.storyboard, { ...approvedScript, status: "draft", revision: 4, approvedRevision: 3 }), false);
  assert.equal(isStoryboardOutdated(result.idea.storyboard, { ...approvedScript, revision: 4, approvedRevision: 4 }), true);
});

test("a second Storyboard run conflicts before calling the Bridge", async () => {
  const { storage, state } = fakeStorage({ ...approvedScript, runId: "storyboard-existing" });
  let bridgeCalls = 0;
  await assert.rejects(
    runScriptStoryboard("script-1", { storage, bridge: async () => { bridgeCalls += 1; return answer; }, now: () => new Date(NOW) }),
    StoryboardConflictError,
  );
  assert.equal(bridgeCalls, 0);
  assert.equal(state.saved, 0);
  assert.equal(state.script.runId, "storyboard-existing");
});

test("a Script reopened between read and claim cannot cross the approval gate", async () => {
  const { storage, state } = fakeStorage();
  const claim = storage.claimScriptRun;
  storage.claimScriptRun = async (...args) => {
    state.script = { ...state.script, status: "draft", revision: 4 };
    return claim(...args);
  };
  let bridgeCalls = 0;
  await assert.rejects(
    runScriptStoryboard("script-1", { storage, bridge: async () => { bridgeCalls += 1; return answer; }, now: () => new Date(NOW) }),
    StoryboardConflictError,
  );
  assert.equal(bridgeCalls, 0);
  assert.equal(state.script.runId, undefined);
  assert.equal(state.saved, 0);
});

test("a failed Storyboard run releases its Script claim", async () => {
  const { storage, state } = fakeStorage();
  await assert.rejects(
    runScriptStoryboard("script-1", { storage, bridge: async () => { throw new Error("Bridge unavailable"); }, now: () => new Date(NOW) }),
    /Bridge unavailable/,
  );
  assert.equal(state.script.runId, undefined);
  assert.equal(state.saved, 0);
});

test("the atomic Storyboard write preserves a concurrent Idea stage change", async () => {
  const { storage, state } = fakeStorage();
  const result = await runScriptStoryboard("script-1", {
    storage,
    bridge: async () => {
      state.idea = { ...state.idea, status: "packaging", goal: "Parallel geändert" };
      return answer;
    },
    now: () => new Date(NOW),
  });
  assert.equal(result.idea.status, "packaging");
  assert.equal(result.idea.goal, "Parallel geändert");
  assert.equal(result.idea.storyboard.scriptId, "script-1");
});

test("a failed Script-claim release is surfaced instead of returning success", async () => {
  const { storage, state } = fakeStorage();
  storage.settleScriptRun = async () => { throw new Error("release failed"); };
  await assert.rejects(
    runScriptStoryboard("script-1", { storage, bridge: async () => answer, now: () => new Date(NOW) }),
    /release failed/,
  );
  assert.equal(state.saved, 1);
});
