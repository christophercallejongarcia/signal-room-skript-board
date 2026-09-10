import test from "node:test";
import assert from "node:assert/strict";
import { claimDevelop, releaseDevelop } from "../lib/ideas.ts";
import { runScriptHooks } from "../lib/script-run.ts";
import { newScript } from "../lib/scripts.ts";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function idea(overrides = {}) {
  return {
    id: "idea-1",
    title: "Sichtbare Belege statt großer Behauptungen",
    goal: "Eine prüfbare Regel zeigen.",
    status: "captured",
    sourceSignalId: "source-1",
    sourceCreator: "@studio",
    sourceUrl: "https://example.com/source-1",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function signal(id, title, overrides = {}) {
  return {
    id,
    creatorId: "creator-1",
    title,
    publishedAt: "2026-08-30T12:00:00.000Z",
    views: 100_000,
    plays: 100_000,
    likes: 1_000,
    comments: 100,
    format: "reel",
    url: `https://example.com/${id}`,
    caption: `Caption für ${title}`,
    transcript: `Original für ${title}`,
    transcriptWorkingCopy: `Geprüft für ${title}`,
    ...overrides,
  };
}

function fakeStorage(initial = {}) {
  const state = {
    ideas: initial.ideas ?? [idea()],
    scripts: initial.scripts ?? [],
    signals: initial.signals ?? [
      signal("source-1", "Die Quelle zeigt den Engpass", { publishedAt: "2026-01-01T12:00:00.000Z", views: 20_000, plays: 20_000 }),
      signal("evidence-1", "Die Reihenfolge schafft Vertrauen", { views: 10_000, plays: 10_000 }),
    ],
    creators: initial.creators ?? [{ id: "creator-1", name: "Studio", handle: "@studio", network: "instagram", audience: 1_000, accent: "#ff6546" }],
  };
  return {
    state,
    async listIdeas() { return state.ideas; },
    async listScripts() { return state.scripts; },
    async listSignals() { return state.signals; },
    async listCreators() { return state.creators; },
    async saveScript(script) {
      state.scripts = [script, ...state.scripts.filter((item) => item.id !== script.id)];
    },
    async claimIdeaDevelop(id, runId, now) {
      const index = state.ideas.findIndex((item) => item.id === id);
      if (index < 0) return null;
      if (state.ideas[index].developRunId && state.ideas[index].developRunId !== runId) throw new Error("idea conflict");
      const claimed = claimDevelop(state.ideas[index], runId, now);
      state.ideas[index] = claimed;
      return claimed;
    },
    async settleIdeaDevelop(id, runId, result) {
      const index = state.ideas.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const settled = result.storyboard === null ? releaseDevelop(state.ideas[index], runId, result.now) : null;
      if (settled) state.ideas[index] = settled;
      return settled;
    },
    async claimScriptRun(id, runId, now) {
      const index = state.scripts.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const claimed = { ...state.scripts[index], runId, updatedAt: now };
      state.scripts[index] = claimed;
      return claimed;
    },
    async settleScriptRun(id, runId, result) {
      const index = state.scripts.findIndex((item) => item.id === id);
      if (index < 0 || state.scripts[index].runId !== runId) return null;
      const { runId: _runId, ...withoutRun } = state.scripts[index];
      const settled = { ...withoutRun, ...result, updatedAt: result.now };
      state.scripts[index] = settled;
      return settled;
    },
  };
}

function bridgeAnswer(request) {
  const evidenceTitle = request.evidence.find((item) => item.id === "evidence-1")?.title ?? request.evidence[0].title;
  return {
    options: [1, 2, 3].map((number) => ({
      hook: `Hook Nummer ${number}: Zeige zuerst, was wirklich passiert.`,
      angle: `Angle ${number} mit einem eigenen Einstieg.`,
      hypothesis: `Hypothese ${number} erklärt, warum dieser Einstieg trägt.`,
      framework: number === 1 ? "pas" : number === 2 ? "bbb" : "none",
      evidence: [{ title: evidenceTitle, fit: "Die Reihenfolge passt zum Thema." }, { title: "Nicht im Paket", fit: "Darf nicht gespeichert werden." }],
    })),
    frameworkRecommendation: { framework: "pas", reason: "Der Engpass steht am Anfang und braucht eine klare Zuspitzung." },
  };
}

function deps(storage, bridge = bridgeAnswer) {
  let counter = 0;
  return {
    storage,
    bridge,
    now: () => NOW,
    createId: (prefix) => `${prefix}-${++counter}`,
    demo: false,
  };
}

test("creates one Hook-Selection Script and sends the reviewed source transcript", async () => {
  const storage = fakeStorage();
  let request;
  const result = await runScriptHooks("idea-1", deps(storage, async (input) => {
    request = input;
    return bridgeAnswer(input);
  }));

  assert.equal(result.script.status, "hook-selection");
  assert.equal(result.script.runId, undefined);
  assert.equal(result.script.sourceSignalId, "source-1");
  assert.deepEqual(result.script.evidenceSignalIds, ["evidence-1"]);
  assert.equal(request.source.transcript, "Geprüft für Die Quelle zeigt den Engpass");
  assert.equal(request.evidence.find((item) => item.id === "evidence-1").transcript, "Geprüft für Die Reihenfolge schafft Vertrauen");
  assert.equal(result.script.hookOptions.length, 3);
  assert.equal(result.script.hookOptions[0].evidence.length, 1);
  assert.equal(result.script.hookOptions[0].evidence[0].signalId, "evidence-1");
  assert.equal(storage.state.ideas[0].developRunId, undefined);
});

test("opens the existing Script without starting another Bridge run", async () => {
  const storage = fakeStorage();
  const first = await runScriptHooks("idea-1", deps(storage));
  let bridgeCalls = 0;
  const second = await runScriptHooks("idea-1", deps(storage, async () => {
    bridgeCalls += 1;
    return bridgeAnswer({ evidence: [] });
  }));
  assert.equal(second.openedExisting, true);
  assert.equal(second.script.id, first.script.id);
  assert.equal(bridgeCalls, 0);
});

test("releases the Idea and Script claims when the Bridge fails", async () => {
  const storage = fakeStorage();
  await assert.rejects(
    runScriptHooks("idea-1", deps(storage, async () => { throw new Error("bridge exploded"); })),
    /bridge exploded/,
  );
  assert.equal(storage.state.ideas[0].developRunId, undefined);
  assert.equal(storage.state.scripts[0].runId, undefined);
  assert.equal(storage.state.scripts[0].hookOptions.length, 0);
});

test("retries an empty Script left behind by a failed first run", async () => {
  const storage = fakeStorage();
  let bridgeCalls = 0;
  await assert.rejects(
    runScriptHooks("idea-1", deps(storage, async () => {
      bridgeCalls += 1;
      throw new Error("temporary bridge failure");
    })),
    /temporary bridge failure/,
  );
  const result = await runScriptHooks("idea-1", deps(storage, async (request) => {
    bridgeCalls += 1;
    return bridgeAnswer(request);
  }));
  assert.equal(bridgeCalls, 2);
  assert.equal(result.openedExisting, undefined);
  assert.equal(result.script.hookOptions.length, 3);
});

test("does not start when the Idea already has an active Develop claim", async () => {
  const storage = fakeStorage({ ideas: [idea({ developRunId: "other-run", status: "developing" })] });
  await assert.rejects(runScriptHooks("idea-1", deps(storage)), /already has a Develop-Lauf/);
});

test("demo mode settles fixed Hook options without calling the Bridge", async () => {
  const storage = fakeStorage({ signals: [], creators: [] });
  const result = await runScriptHooks("idea-1", { ...deps(storage), demo: true, bridge: async () => { throw new Error("must not call"); } });
  assert.equal(result.script.hookOptions.length, 3);
  assert.equal(result.script.framework, "pas");
});

test("a new Script starts empty even when its source is outside the evidence window", () => {
  const script = newScript({ ideaId: "idea-1", sourceSignalId: "source-1" }, { id: "script-1", now: NOW.toISOString() });
  assert.equal(script.status, "hook-selection");
  assert.deepEqual(script.evidenceSignalIds, []);
});
