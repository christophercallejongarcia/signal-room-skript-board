import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

