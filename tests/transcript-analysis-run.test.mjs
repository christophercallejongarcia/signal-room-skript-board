import test from "node:test";
import assert from "node:assert/strict";
import { createTranscriptAnalysis } from "../lib/transcript-analysis.ts";
import { processTranscriptAnalyses } from "../lib/transcript-analysis-run.ts";

test("local worker claims a queued analysis and persists validated findings", async () => {
  const signal = {
    id: "ig-worker-1",
    format: "reel",
    transcript: "Hook. Beweis.",
    transcriptStatus: "ready",
    transcriptSegments: [{ start: 0, end: 2, text: "Hook. Beweis." }],
  };
  const queued = createTranscriptAnalysis(signal, "2026-09-10T10:00:00.000Z", "analysis-run-1");
  const claimed = { ...queued, status: "running", claimId: "claim-1", attempts: 1 };
  let request;
  let settled;
  const storage = {
    async listSignals() { return [signal]; },
    async claimTranscriptAnalysis(_now, claimId) { assert.equal(claimId, "worker-1"); return claimed; },
    async settleTranscriptAnalysis(id, claimId, result) {
      assert.equal(id, queued.id);
      assert.equal(claimId, "claim-1");
      settled = result;
      return { ...claimed, ...result, status: result.status };
    },
  };
  const result = await processTranscriptAnalyses({
    storage,
    bridge: async (input) => {
      request = input;
      return { framework: "pas", findings: [{ feature: "hook", explanation: "Der Einstieg.", quote: "Hook.", start: 0, end: 5 }] };
    },
    now: () => new Date("2026-09-10T10:01:00.000Z"),
    createId: () => "worker-1",
    limit: 1,
  });
  assert.equal(result.completed, 1);
  assert.equal(request.text, signal.transcript);
  assert.equal(request.offset, 0);
  assert.equal(settled.status, "complete");
  assert.equal(settled.findings[0].quote, "Hook.");
  assert.deepEqual(settled.findings[0].timecode, { start: 0, end: 2 });
});

test("later chunks keep original positions when mapping a finding to a timecode", async () => {
  const signal = {
    id: "ig-worker-later-chunk",
    format: "reel",
    transcript: "AAAAAAAAAAAAAZweiter Beweis.",
    transcriptStatus: "ready",
    transcriptSegments: [
      { start: 0, end: 2, text: "AAAAAAAAAAAAA" },
      { start: 2, end: 5, text: "Zweiter Bewei" },
    ],
  };
  const queued = createTranscriptAnalysis(signal, "2026-09-10T10:00:00.000Z", "analysis-run-2");
  const claimed = { ...queued, status: "running", claimId: "claim-2", attempts: 1 };
  let settled;
  const storage = {
    async listSignals() { return [signal]; },
    async claimTranscriptAnalysis() { return claimed; },
    async settleTranscriptAnalysis(_id, _claimId, result) { settled = result; return { ...claimed, ...result }; },
  };
  await processTranscriptAnalyses({
    storage,
    bridge: async (request) => request.chunkIndex === 1
      ? { framework: "bbb", findings: [{ feature: "proof", explanation: "Beleg", quote: "Zweiter Bewei", start: 0, end: 13 }] }
      : { framework: "none", findings: [] },
    now: () => new Date("2026-09-10T10:01:00.000Z"),
    createId: () => "claim-2",
    limit: 1,
    chunkSize: 13,
  });
  assert.equal(settled.findings[0].start, 13);
  assert.deepEqual(settled.findings[0].timecode, { start: 2, end: 5 });
});

test("bounded worker stores missing chunks instead of calling a partial run complete", async () => {
  const signal = { id: "ig-long", format: "reel", transcript: "A".repeat(30), transcriptStatus: "ready" };
  const queued = createTranscriptAnalysis(signal, "2026-09-10T10:00:00.000Z", "analysis-run-long");
  const claimed = { ...queued, status: "running", claimId: "claim-long", attempts: 1 };
  let settled;
  const storage = {
    async listSignals() { return [signal]; },
    async claimTranscriptAnalysis() { return claimed; },
    async settleTranscriptAnalysis(_id, _claimId, result) { settled = result; return { ...claimed, ...result }; },
  };
  await processTranscriptAnalyses({
    storage,
    bridge: async () => ({ framework: "none", findings: [] }),
    now: () => new Date("2026-09-10T10:01:00.000Z"),
    createId: () => "claim-long",
    limit: 1,
    chunkSize: 10,
    maxChunks: 2,
  });
  assert.equal(settled.status, "complete");
  assert.equal(settled.complete, false);
  assert.deepEqual(settled.chunks.map((chunk) => chunk.status), ["complete", "complete", "missing"]);
});

test("Bridge failure settles the claimed analysis as failed with a bounded cause", async () => {
  const signal = { id: "ig-bridge-down", format: "reel", transcript: "Hook.", transcriptStatus: "ready" };
  const queued = createTranscriptAnalysis(signal, "2026-09-10T10:00:00.000Z", "analysis-run-failed");
  const claimed = { ...queued, status: "running", claimId: "claim-failed", attempts: 1 };
  let settled;
  const storage = {
    async listSignals() { return [signal]; },
    async claimTranscriptAnalysis() { return claimed; },
    async settleTranscriptAnalysis(_id, _claimId, result) { settled = result; return { ...claimed, ...result }; },
  };
  const result = await processTranscriptAnalyses({
    storage,
    bridge: async () => { throw new Error(`Bridge offline ${"x".repeat(400)}`); },
    now: () => new Date("2026-09-10T10:01:00.000Z"),
    createId: () => "claim-failed",
    limit: 1,
  });
  assert.equal(result.failed, 1);
  assert.equal(settled.status, "failed");
  assert.match(settled.error, /Bridge offline/);
  assert.equal(settled.error.length, 300);
});
