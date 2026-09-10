import test from "node:test";
import assert from "node:assert/strict";
import { chunkTranscript, createTranscriptAnalysis, hashTranscriptText, parseTranscriptAnalysisAction, parseTranscriptAnalysisResponse, transcriptAnalysisView, timecodeForFinding, validateTranscriptAnalysisSettlement } from "../lib/transcript-analysis.ts";
import { enqueueTranscriptAnalyses, TRANSCRIPT_ANALYSIS_CATCH_UP_INSPECTION_LIMIT } from "../lib/transcript-analysis-run.ts";

test("hashes the exact transcript text with SHA-256", () => {
  assert.equal(
    hashTranscriptText("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("accepts only literal findings inside the supplied transcript", () => {
  const text = "Hook zuerst. Beweis folgt.";
  const parsed = parseTranscriptAnalysisResponse({
    framework: "pas",
    findings: [{ feature: "hook", explanation: "Der Einstieg.", quote: "Hook zuerst.", start: 0, end: 12 }],
  }, text);

  assert.deepEqual(parsed.findings[0], {
    feature: "hook",
    explanation: "Der Einstieg.",
    quote: "Hook zuerst.",
    start: 0,
    end: 12,
  });
  assert.throws(() => parseTranscriptAnalysisResponse({
    framework: "pas",
    findings: [{ feature: "hook", explanation: "Erfunden.", quote: "Nicht im Text", start: 0, end: 13 }],
  }, text), /literal|quote|position/i);
});

test("chunks preserve Unicode text and contiguous positions", () => {
  const text = "Hook 😀 zuerst. Beweis folgt mit einem langen Satz.";
  const chunks = chunkTranscript(text, 16);
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks.at(-1).end, text.length);
  assert.deepEqual(chunks.map((chunk) => text.slice(chunk.start, chunk.end)), chunks.map((chunk) => chunk.text));
  assert.equal(chunks.every((chunk) => chunk.text.length <= 16), true);
  assert.equal(chunks.every((chunk, index) => index === 0 || chunk.start === chunks[index - 1].end), true);
});

test("maps a finding to a unique original segment, but leaves ambiguous working text without timecode", () => {
  const original = "Falsch erkannt. Das bleibt der Beleg.";
  const working = "Richtig erkannt. Das bleibt der Beleg.";
  const segment = { start: 2.5, end: 5.5, text: "Das bleibt der Beleg." };
  const finding = { feature: "proof", explanation: "Der Beleg.", quote: "Das bleibt der Beleg.", start: 17, end: working.length };
  assert.deepEqual(timecodeForFinding(finding, working, original, [segment]), { start: 2.5, end: 5.5 });
  assert.equal(timecodeForFinding({ ...finding, quote: "erkannt" }, working, original, [
    segment,
    { start: 0, end: 1, text: "erkannt" },
    { start: 1, end: 2, text: "erkannt" },
  ]), undefined);
});

test("queues the working transcript with an exact hash and stable deduplication key", () => {
  const signal = {
    id: "signal-1",
    format: "reel",
    transcript: "Original mit Fehler.",
    transcriptWorkingCopy: "Arbeitsfassung mit Korrektur.",
  };
  const first = createTranscriptAnalysis(signal, "2026-09-10T10:00:00.000Z", "run-1");
  const second = createTranscriptAnalysis(signal, "2026-09-10T11:00:00.000Z", "run-2");
  assert.equal(first.textVersion, "working");
  assert.equal(first.textHash, hashTranscriptText(signal.transcriptWorkingCopy));
  assert.equal(first.id, second.id);
  assert.equal(first.status, "queued");
});

test("bounded catch-up queues only finished Reel transcripts through the storage boundary", async () => {
  const calls = [];
  const signals = [
    { id: "ready", format: "reel", transcript: "Fertig.", transcriptStatus: "ready" },
    { id: "pending", format: "reel", transcript: "Läuft.", transcriptStatus: "pending" },
    { id: "post", format: "post", transcript: "Kein Reel.", transcriptStatus: "ready" },
  ];
  const storage = {
    async listSignals() { return signals; },
    async listTranscriptAnalyses() { return []; },
    async enqueueTranscriptAnalysis(signalId, now) {
      calls.push({ signalId, now });
      return createTranscriptAnalysis(signals.find((signal) => signal.id === signalId), now, `run-${signalId}`);
    },
  };
  const result = await enqueueTranscriptAnalyses(storage, { now: new Date("2026-09-10T10:00:00.000Z"), limit: 1 });
  assert.equal(result.queued, 1);
  assert.deepEqual(calls, [{ signalId: "ready", now: "2026-09-10T10:00:00.000Z" }]);
});

test("bounded catch-up skips existing analyses without starving later unfinished Reels", async () => {
  const signals = ["old-a", "old-b", "new-a", "new-b"].map((id) => ({
    id,
    format: "reel",
    transcript: `Transcript ${id}`,
    transcriptStatus: "ready",
  }));
  const existing = signals.slice(0, 2).map((signal) => createTranscriptAnalysis(signal, "2026-09-09T10:00:00.000Z", `run-${signal.id}`));
  const calls = [];
  const storage = {
    async listSignals() { return signals; },
    async listTranscriptAnalyses({ analysisId } = {}) { return existing.filter((analysis) => !analysisId || analysis.id === analysisId); },
    async enqueueTranscriptAnalysis(signalId, now) {
      calls.push(signalId);
      return createTranscriptAnalysis(signals.find((signal) => signal.id === signalId), now, `run-${signalId}`);
    },
  };
  const result = await enqueueTranscriptAnalyses(storage, { now: new Date("2026-09-10T10:00:00.000Z"), limit: 2 });
  assert.deepEqual(calls, ["new-a", "new-b"]);
  assert.equal(result.queued, 2);
  assert.equal(result.existing, 2);
});

test("catch-up bounds lookup work and continues after its last inspected Signal", async () => {
  const signals = Array.from({ length: TRANSCRIPT_ANALYSIS_CATCH_UP_INSPECTION_LIMIT + 2 }, (_, index) => ({
    id: `page-${String(index).padStart(4, "0")}`,
    format: "reel",
    transcript: `Transcript ${index}`,
    transcriptStatus: "ready",
  }));
  const existing = new Map(signals.slice(0, -1).map((signal) => {
    const analysis = createTranscriptAnalysis(signal, "2026-09-09T10:00:00.000Z", `run-${signal.id}`);
    return [analysis.id, analysis];
  }));
  let lookups = 0;
  const storage = {
    async listSignals() { return signals; },
    async listTranscriptAnalyses({ analysisId }) {
      lookups += 1;
      return existing.has(analysisId) ? [existing.get(analysisId)] : [];
    },
    async enqueueTranscriptAnalysis(signalId, now) {
      return createTranscriptAnalysis(signals.find((signal) => signal.id === signalId), now, `run-${signalId}`);
    },
  };

  const first = await enqueueTranscriptAnalyses(storage, { now: new Date("2026-09-10T10:00:00.000Z"), limit: 1 });
  assert.equal(first.queued, 0);
  assert.equal(first.nextCursor, `page-${String(TRANSCRIPT_ANALYSIS_CATCH_UP_INSPECTION_LIMIT - 1).padStart(4, "0")}`);
  assert.equal(lookups, TRANSCRIPT_ANALYSIS_CATCH_UP_INSPECTION_LIMIT);

  const second = await enqueueTranscriptAnalyses(storage, {
    now: new Date("2026-09-10T10:01:00.000Z"),
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.deepEqual(second.analyses.map((analysis) => analysis.signalId), [`page-${String(TRANSCRIPT_ANALYSIS_CATCH_UP_INSPECTION_LIMIT + 1).padStart(4, "0")}`]);
  assert.equal(second.nextCursor, undefined);
  assert.equal(lookups, TRANSCRIPT_ANALYSIS_CATCH_UP_INSPECTION_LIMIT + 2);
  await assert.rejects(
    enqueueTranscriptAnalyses(storage, { limit: 1, cursor: "missing-cursor" }),
    /cursor/i,
  );
});

test("API actions validate signal ids, bounded catch-up and explicit retries", () => {
  assert.deepEqual(parseTranscriptAnalysisAction({ action: "run", signalId: " reel-1 " }), { action: "run", signalId: "reel-1" });
  assert.deepEqual(parseTranscriptAnalysisAction({ action: "catch-up", limit: 8 }), { action: "catch-up", limit: 8 });
  assert.deepEqual(parseTranscriptAnalysisAction({ action: "catch-up", limit: 8, cursor: " reel-500 " }), { action: "catch-up", limit: 8, cursor: "reel-500" });
  assert.deepEqual(parseTranscriptAnalysisAction({ action: "retry", analysisId: "analysis-1" }), { action: "retry", analysisId: "analysis-1" });
  assert.throws(() => parseTranscriptAnalysisAction({ action: "catch-up", limit: 0 }), /limit/i);
  assert.throws(() => parseTranscriptAnalysisAction({ action: "retry" }), /analysisId/i);
});

test("Reel view marks an older complete analysis stale after the working copy changes", () => {
  const signal = { id: "signal-view", format: "reel", transcript: "Original.", transcriptWorkingCopy: "Neue Arbeitsfassung." };
  const old = createTranscriptAnalysis({ ...signal, transcriptWorkingCopy: undefined }, "2026-09-09T10:00:00.000Z", "run-old");
  old.status = "complete";
  old.complete = true;
  const view = transcriptAnalysisView(signal, [old]);
  assert.equal(view.status, "stale");
  assert.equal(view.analysis.id, old.id);
});

test("storage settlement validation rejects forged positions and false full coverage", () => {
  const base = {
    status: "complete",
    now: "2026-09-10T10:00:00.000Z",
    framework: "pas",
    findings: [{ feature: "hook", explanation: "Belegt", quote: "Hook", start: 0, end: 4 }],
    chunks: [{ index: 0, start: 0, end: 10, status: "missing" }],
    textLength: 10,
    complete: false,
  };
  assert.doesNotThrow(() => validateTranscriptAnalysisSettlement(base, "Hook folgt"));
  assert.throws(() => validateTranscriptAnalysisSettlement({ ...base, findings: [{ ...base.findings[0], start: 1, end: 5 }] }, "Hook folgt"), /outside/i);
  assert.throws(() => validateTranscriptAnalysisSettlement({ ...base, complete: true }, "Hook folgt"), /completeness/i);
});
