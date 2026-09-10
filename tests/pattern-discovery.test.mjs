import test from "node:test";
import assert from "node:assert/strict";
import { discoverPattern } from "../lib/pattern-discovery-run.ts";
import { createTranscriptAnalysis } from "../lib/transcript-analysis.ts";

const NOW = new Date("2026-09-10T12:00:00.000Z");

function creator(id, audience = 1000, extra = {}) {
  return { id, name: id, handle: `@${id}`, network: "instagram", audience, accent: "#fff", market: "de", ...extra };
}

function reel(id, creatorId, plays, days = 12, extra = {}) {
  return {
    id, creatorId, title: id, publishedAt: new Date(NOW.getTime() - days * 86_400_000).toISOString(),
    views: plays, plays, likes: 0, comments: 0, durationSeconds: 30, thumbnailSeed: id,
    topic: "ki-agenten", format: "reel", transcript: `Volltext ${id}`, transcriptStatus: "ready",
    url: `https://www.instagram.com/reel/${id}/`, ...extra,
  };
}

function analysis(signal, extra = {}) {
  return {
    ...createTranscriptAnalysis(signal, "2026-09-10T10:00:00.000Z", `analysis-run-${signal.id}`),
    status: "complete", attempts: 1, completedAt: "2026-09-10T10:01:00.000Z", framework: "none",
    findings: [], chunks: [{ index: 0, start: 0, end: signal.transcript.length, status: "complete" }],
    textLength: signal.transcript.length, complete: true, ...extra,
  };
}

function fakeStorage(creators, signals, analyses) {
  const state = { patterns: [], evidence: [], runs: [] };
  return {
    state,
    async listCreators() { return creators; },
    async listSignals() { return signals; },
    async listTranscriptAnalyses() { return analyses; },
    async savePatternComparison(result) {
      const found = state.runs.find((run) => run.id === result.run.id);
      if (found) return { pattern: state.patterns[0], run: found, evidence: state.evidence };
      state.patterns.push(result.pattern); state.evidence.push(...result.evidence); state.runs.push(result.run);
      return result;
    },
  };
}

test("the saved definition is checked explicitly and threshold equality proposes a candidate", async () => {
  const creators = [creator("a"), creator("b"), creator("c"), creator("d")];
  const positives = [reel("p1", "a", 9000), reel("p2", "a", 8000), reel("p3", "b", 7000), reel("p4", "b", 6000), reel("p5", "c", 5000)];
  const negatives = [reel("n1", "a", 1000), reel("n2", "b", 900), reel("n3", "c", 800), reel("n4", "d", 700), reel("n5", "d", 0)];
  const signals = [...positives, ...negatives];
  const storage = fakeStorage(creators, signals, signals.map(analysis));
  const definitions = [];
  const result = await discoverPattern({ sourceSignalIds: positives.map((item) => item.id), market: "de", niche: "core", topic: "ki-agenten", ageBucket: "8-30", owned: false }, {
    storage,
    now: () => NOW,
    createId: () => "pattern-run-fixed",
    bridge: {
      async hypothesize() { return { name: "Konkreter Beweis vor CTA", definition: "Ein überprüfbarer Beleg steht vor dem CTA.", structure: ["Beleg", "CTA"] }; },
      async evaluate(input) {
        definitions.push(input.definition);
        const present = input.signalId.startsWith("p");
        return present
          ? { verdict: "present", explanation: "Beleg gefunden.", quote: input.text.slice(0, 8), start: 0, end: 8 }
          : { verdict: "absent", explanation: "Definition ausdrücklich nicht erfüllt." };
      },
    },
  });
  assert.equal(new Set(definitions).size, 1);
  assert.equal(definitions[0], result.pattern.definition);
  assert.equal(result.run.positiveCount, 5);
  assert.equal(result.run.negativeCount, 5);
  assert.equal(result.run.positiveCreatorCount, 3);
  assert.equal(result.run.status, "candidate");
  assert.equal(result.pattern.status, "candidate");
  assert.equal(result.run.positiveMedian, 7);
  assert.equal(result.run.negativeMedian, 0.8);
  assert.equal(result.run.medianDelta, 6.2);
  assert.match(result.run.caution, /keine Kausalität/i);
});

test("unknown analyses, duplicate Reels, market and owned boundaries cannot improve evidence", async () => {
  const creators = [creator("a"), creator("b"), creator("c"), creator("en", 1000, { market: "en" }), creator("foreign", 1000, { foreign: true }), creator("own", 1000, { owned: true })];
  const inScope = [reel("p1", "a", 5000), reel("p2", "a", 5000), reel("p3", "b", 5000), reel("p4", "b", 5000), reel("p5", "c", 5000), reel("unknown", "c", 1000)];
  const signals = [...inScope, inScope[0], reel("english", "en", 100), reel("foreign", "foreign", 100), reel("owned", "own", 100), reel("old", "c", 100, 45), reel("other-topic", "c", 100, 12, { topic: "automation" })];
  const analyses = inScope.filter((item) => item.id !== "unknown").map(analysis);
  analyses.push(analysis(inScope[4], { id: "stale", textHash: "old-hash", createdAt: "2026-09-09T10:00:00.000Z" }));
  const storage = fakeStorage(creators, signals, analyses);
  let evaluated = 0;
  const result = await discoverPattern({ sourceSignalIds: inScope.slice(0, 5).map((item) => item.id), market: "de", niche: "core", topic: "ki-agenten", ageBucket: "8-30", owned: false }, {
    storage, now: () => NOW, createId: () => "run-boundaries",
    bridge: {
      async hypothesize() { return { name: "Beweis", definition: "Beweis vor CTA", structure: ["Beweis"] }; },
      async evaluate(input) { evaluated += 1; return { verdict: input.signalId.startsWith("p") ? "present" : "absent", explanation: "Explizit geprüft." }; },
    },
  });
  assert.equal(evaluated, 5);
  assert.equal(result.run.positiveCount, 5);
  assert.equal(result.run.negativeCount, 0);
  assert.equal(result.run.unknownCount, 1);
  assert.equal(result.run.status, "insufficient");
  assert.deepEqual(result.run.excluded, { duplicate: 1, market: 1, niche: 1, topic: 1, age: 1, owned: 1, incompleteAnalysis: 1, invalidOutlier: 0 });
});

test("one creator, missing followers and a non-positive delta stay hypotheses", async () => {
  const creators = [creator("solo"), creator("missing", Number.NaN), creator("n1"), creator("n2"), creator("n3")];
  const positive = [1, 2, 3, 4, 5].map((n) => reel(`p${n}`, "solo", 1000));
  const negative = [1, 2, 3, 4, 5].map((n) => reel(`n${n}`, n < 3 ? "n1" : n < 5 ? "n2" : "n3", 2000));
  const missing = reel("missing-followers", "missing", 100000);
  const signals = [...positive, ...negative, missing];
  const storage = fakeStorage(creators, signals, signals.map(analysis));
  const result = await discoverPattern({ sourceSignalIds: positive.map((item) => item.id), market: "de", niche: "core", topic: "ki-agenten", ageBucket: "8-30", owned: false }, {
    storage, now: () => NOW, createId: () => "run-negative",
    thresholds: { positiveReels: 5, positiveCreators: 3, negativeReels: 5 },
    bridge: {
      async hypothesize() { return { name: "Beweis", definition: "Beweis vor CTA", structure: ["Beweis"] }; },
      async evaluate(input) { return { verdict: input.signalId.startsWith("p") || input.signalId.startsWith("missing") ? "present" : "absent", explanation: "Explizit geprüft." }; },
    },
  });
  assert.equal(result.run.positiveCreatorCount, 1);
  assert.equal(result.run.positiveMedian, 1);
  assert.equal(result.run.negativeMedian, 2);
  assert.equal(result.run.medianDelta, -1);
  assert.equal(result.run.status, "insufficient");
  assert.equal(result.run.excluded.invalidOutlier, 1);
});

test("an identical definition and data basis save one bounded idempotent run", async () => {
  const creators = [creator("a"), creator("b"), creator("c")];
  const signals = [1, 2, 3, 4, 5].map((n) => reel(`p${n}`, n < 3 ? "a" : n < 5 ? "b" : "c", 5000));
  const storage = fakeStorage(creators, signals, signals.map(analysis));
  const deps = { storage, now: () => NOW, createId: () => "ignored-random", bridge: {
    async hypothesize() { return { name: "Beweis", definition: "Beweis vor CTA", structure: ["Beweis"] }; },
    async evaluate() { return { verdict: "present", explanation: "Explizit geprüft." }; },
  } };
  const request = { sourceSignalIds: signals.map((item) => item.id), market: "de", niche: "core", topic: "ki-agenten", ageBucket: "8-30", owned: false };
  const first = await discoverPattern(request, deps);
  const second = await discoverPattern(request, deps);
  assert.equal(first.run.id, second.run.id);
  assert.equal(storage.state.runs.length, 1);
  assert.equal(storage.state.evidence.length, 5);
});

test("a complete comparison basis with a negative median difference is not a candidate", async () => {
  const creators = [creator("a"), creator("b"), creator("c")];
  const positive = [1, 2, 3, 4, 5].map((n) => reel(`p${n}`, n < 3 ? "a" : n < 5 ? "b" : "c", 1000));
  const negative = [1, 2, 3, 4, 5].map((n) => reel(`n${n}`, n < 3 ? "a" : n < 5 ? "b" : "c", 3000));
  const signals = [...positive, ...negative];
  const storage = fakeStorage(creators, signals, signals.map(analysis));
  const result = await discoverPattern({ sourceSignalIds: positive.map((item) => item.id), market: "de", niche: "core", topic: "ki-agenten", ageBucket: "8-30", owned: false }, {
    storage, now: () => NOW, createId: () => "run-non-positive",
    bridge: {
      async hypothesize() { return { name: "Beweis", definition: "Beweis vor CTA", structure: ["Beweis"] }; },
      async evaluate(input) { return { verdict: input.signalId.startsWith("p") ? "present" : "absent", explanation: "Explizit geprüft." }; },
    },
  });
  assert.equal(result.run.positiveCount, 5);
  assert.equal(result.run.negativeCount, 5);
  assert.equal(result.run.positiveCreatorCount, 3);
  assert.equal(result.run.medianDelta, -2);
  assert.equal(result.run.status, "non-positive");
  assert.equal(result.pattern.status, "hypothesis");
});
