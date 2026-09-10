import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { enqueueTranscriptAnalyses, processTranscriptAnalyses } from "../lib/transcript-analysis-run.ts";
import { createTranscriptAnalysis } from "../lib/transcript-analysis.ts";

const signal = {
  id: "ig-analysis-1",
  externalId: "analysis-1",
  creatorId: "creator-1",
  title: "Analyse",
  publishedAt: "2026-09-10T08:00:00.000Z",
  views: 1000,
  plays: 1000,
  likes: 10,
  comments: 2,
  durationSeconds: 30,
  thumbnailSeed: "analysis",
  topic: "testing",
  format: "reel",
  url: "https://instagram.test/reel/analysis-1",
  transcript: "Hook. Beweis.",
  transcriptStatus: "ready",
};

test("file storage queues a finished transcript idempotently at saveSignals", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "transcript-analysis-storage-"));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const { fileStorage } = await import(`../lib/adapters/storage/file.ts?storage=${Date.now()}`);
    await fileStorage.saveSignals([signal]);
    const first = await fileStorage.listTranscriptAnalyses({ signalId: signal.id });
    await fileStorage.saveSignals([signal]);
    const second = await fileStorage.listTranscriptAnalyses({ signalId: signal.id });
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(second[0].id, first[0].id);
    assert.equal(second[0].textHash, first[0].textHash);
  } finally {
    process.chdir(previous);
    await rm(dir, { recursive: true, force: true });
  }
});

test("bounded catch-up reaches a new Reel after more than 500 existing analyses and stays idempotent", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "transcript-analysis-catch-up-"));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const signals = Array.from({ length: 502 }, (_, index) => ({
      ...signal,
      id: `ig-${index}`,
      externalId: `${index}`,
      transcript: `Transcript ${index}.`,
    }));
    const existing = signals.slice(0, 501).map((item, index) => {
      const createdAt = new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString();
      return createTranscriptAnalysis(item, createdAt, `run-${index}`);
    });
    await mkdir(path.join(dir, "data"), { recursive: true });
    await writeFile(path.join(dir, "data", "store.json"), JSON.stringify({
      creators: [],
      signals,
      transcriptDictionary: [],
      hashtagPosts: [],
      runs: [],
      ideas: [],
      scripts: [],
      formatReviews: [],
      hookRuns: [],
      briefings: [],
      slates: [],
      transcriptAnalyses: existing,
    }), "utf8");
    const { fileStorage } = await import(`../lib/adapters/storage/file.ts?catch-up=${Date.now()}`);

    const first = await enqueueTranscriptAnalyses(fileStorage, {
      now: new Date("2026-09-10T10:00:00.000Z"),
      limit: 1,
    });
    assert.deepEqual(first.analyses.map((analysis) => analysis.signalId), ["ig-501"]);
    assert.deepEqual({ queued: first.queued, existing: first.existing, skipped: first.skipped }, { queued: 1, existing: 501, skipped: 0 });
    assert.equal((await fileStorage.listTranscriptAnalyses({ signalId: "ig-501", limit: 1 })).length, 1);

    const unchanged = await Promise.all(existing.map(async (analysis) => {
      const [stored] = await fileStorage.listTranscriptAnalyses({ signalId: analysis.signalId, limit: 1 });
      return { id: stored?.id, status: stored?.status, createdAt: stored?.createdAt };
    }));
    assert.deepEqual(unchanged, existing.map((analysis) => ({
      id: analysis.id,
      status: analysis.status,
      createdAt: analysis.createdAt,
    })));

    const second = await enqueueTranscriptAnalyses(fileStorage, {
      now: new Date("2026-09-10T10:01:00.000Z"),
      limit: 1,
    });
    assert.deepEqual({ queued: second.queued, existing: second.existing, skipped: second.skipped }, { queued: 0, existing: 502, skipped: 0 });
    assert.equal((await fileStorage.listTranscriptAnalyses({ signalId: "ig-501", limit: 10 })).length, 1);
  } finally {
    process.chdir(previous);
    await rm(dir, { recursive: true, force: true });
  }
});

test("file storage serializes claims, expires them, and rejects late or exhausted work", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "transcript-analysis-claims-"));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const { fileStorage } = await import(`../lib/adapters/storage/file.ts?claims=${Date.now()}`);
    const claimSignal = { ...signal, id: "ig-analysis-claims", externalId: "analysis-claims", transcript: "Claim me once." };
    await fileStorage.saveSignals([claimSignal]);
    const queued = await fileStorage.enqueueTranscriptAnalysis(claimSignal.id, "2026-09-10T10:00:00.000Z");
    const first = await fileStorage.claimTranscriptAnalysis("2026-09-10T10:00:00.000Z", "claim-a");
    assert.equal(first?.id, queued?.id);
    assert.equal(first?.attempts, 1);
    assert.equal(await fileStorage.claimTranscriptAnalysis("2026-09-10T10:00:01.000Z", "claim-b"), null);

    const expiredAt = new Date(Date.parse("2026-09-10T10:00:00.000Z") + 10 * 60_000).toISOString();
    const second = await fileStorage.claimTranscriptAnalysis(expiredAt, "claim-b");
    assert.equal(second?.claimId, "claim-b");
    assert.equal(second?.attempts, 2);
    assert.equal(await fileStorage.settleTranscriptAnalysis(queued.id, "claim-a", {
      status: "complete",
      now: "2026-09-10T10:10:01.000Z",
      complete: true,
    }), null);

    await fileStorage.settleTranscriptAnalysis(queued.id, "claim-b", {
      status: "failed",
      now: "2026-09-10T10:10:02.000Z",
      error: "Bridge offline",
    });
    const retried = await fileStorage.retryTranscriptAnalysis(queued.id, "2026-09-10T10:11:00.000Z");
    assert.equal(retried?.status, "queued");
    const third = await fileStorage.claimTranscriptAnalysis("2026-09-10T10:11:00.000Z", "claim-c");
    assert.equal(third?.attempts, 3);
    await fileStorage.settleTranscriptAnalysis(queued.id, "claim-c", {
      status: "failed",
      now: "2026-09-10T10:21:01.000Z",
      error: "Bridge offline again",
    });
    await assert.rejects(
      fileStorage.retryTranscriptAnalysis(queued.id, "2026-09-10T10:22:00.000Z"),
      /attempt limit/i,
    );
  } finally {
    process.chdir(previous);
    await rm(dir, { recursive: true, force: true });
  }
});

test("file storage rejects a late result after the signal text changes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "transcript-analysis-stale-"));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const { fileStorage } = await import(`../lib/adapters/storage/file.ts?stale=${Date.now()}`);
    const staleSignal = { ...signal, id: "ig-analysis-stale", externalId: "analysis-stale" };
    await fileStorage.saveSignals([staleSignal]);
    const queued = await fileStorage.enqueueTranscriptAnalysis(staleSignal.id, "2026-09-10T10:00:00.000Z");
    await fileStorage.claimTranscriptAnalysis("2026-09-10T10:00:00.000Z", "claim-stale");
    await fileStorage.patchTranscript(staleSignal.id, {
      transcript: "A newer transcript.",
      transcriptStatus: "ready",
      transcriptUpdatedAt: "2026-09-10T10:00:01.000Z",
    });
    assert.equal(await fileStorage.settleTranscriptAnalysis(queued.id, "claim-stale", {
      status: "complete",
      now: "2026-09-10T10:00:02.000Z",
      complete: true,
    }), null);
    const analyses = await fileStorage.listTranscriptAnalyses({ signalId: staleSignal.id });
    assert.equal(analyses.find((analysis) => analysis.id === queued.id)?.status, "running");
    assert.equal(analyses.length, 2);
  } finally {
    process.chdir(previous);
    await rm(dir, { recursive: true, force: true });
  }
});

test("manual worker completes the selected Reel while an older queued Reel stays untouched", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "transcript-analysis-selected-"));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const { fileStorage } = await import(`../lib/adapters/storage/file.ts?selected=${Date.now()}`);
    const older = { ...signal, id: "ig-analysis-older", externalId: "analysis-older", transcript: "Older Reel." };
    const selectedSignal = { ...signal, id: "ig-analysis-selected", externalId: "analysis-selected", transcript: "Selected Reel." };
    await fileStorage.saveSignals([older]);
    await fileStorage.saveSignals([selectedSignal]);
    const [selected] = await fileStorage.listTranscriptAnalyses({ signalId: selectedSignal.id });
    const result = await processTranscriptAnalyses({
      storage: fileStorage,
      bridge: async () => ({ framework: "none", findings: [] }),
      now: () => new Date("2026-09-10T10:01:00.000Z"),
      createId: () => "selected-claim",
      limit: 1,
      analysisId: selected.id,
    });
    assert.equal(result.completed, 1);
    assert.equal((await fileStorage.listTranscriptAnalyses({ signalId: selectedSignal.id }))[0].status, "complete");
    assert.equal((await fileStorage.listTranscriptAnalyses({ signalId: older.id }))[0].status, "queued");
  } finally {
    process.chdir(previous);
    await rm(dir, { recursive: true, force: true });
  }
});
