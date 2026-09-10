import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const comparison = {
  pattern: { id: "pattern-a", name: "Beleg", definition: "Beleg vor CTA", structure: ["Beleg", "CTA"], status: "candidate", revision: 1, createdAt: "2026-09-10T10:00:00.000Z", updatedAt: "2026-09-10T10:00:00.000Z" },
  evidence: [{ id: "run-a:ig-a", patternId: "pattern-a", runId: "run-a", signalId: "ig-a", analysisId: "analysis-a", verdict: "present", explanation: "Beleg", evaluatedAt: "2026-09-10T10:00:00.000Z", outlier: 4 }],
  run: { id: "run-a", patternId: "pattern-a", createdAt: "2026-09-10T10:00:00.000Z", windowDays: 90, scope: { market: "de", niche: "core", topic: "ki-agenten", ageBucket: "8-30", owned: false }, thresholds: { positiveReels: 5, positiveCreators: 3, negativeReels: 5 }, status: "insufficient", positiveEvidenceIds: ["run-a:ig-a"], negativeEvidenceIds: [], unknownEvidenceIds: [], positiveCount: 1, negativeCount: 0, unknownCount: 0, positiveCreatorCount: 1, positiveMedian: 4, excluded: { duplicate: 0, market: 0, niche: 0, topic: 0, age: 0, owned: 0, incompleteAnalysis: 0, invalidOutlier: 0 }, caution: "Keine Kausalität." },
};

test("file storage saves Pattern evidence separately and an identical run is a no-op", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pattern-storage-"));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const { fileStorage } = await import(`../lib/adapters/storage/file.ts?pattern=${Date.now()}`);
    await fileStorage.savePatternComparison(comparison);
    await fileStorage.savePatternComparison(comparison);
    assert.deepEqual(await fileStorage.listPatternComparisons(10), [comparison]);
    const raw = JSON.parse(await readFile(path.join(dir, "data", "store.json"), "utf8"));
    assert.equal(raw.patterns.length, 1);
    assert.equal(raw.patternEvidence.length, 1);
    assert.equal(raw.patternComparisonRuns.length, 1);
    assert.equal("evidence" in raw.patternComparisonRuns[0], false);
  } finally {
    process.chdir(previous);
    await rm(dir, { recursive: true, force: true });
  }
});
