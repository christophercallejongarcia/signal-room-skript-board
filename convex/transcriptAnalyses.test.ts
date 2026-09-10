/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const signal = {
  id: "ig-convex-analysis-1",
  creatorId: "creator-1",
  title: "Convex Analyse",
  publishedAt: "2026-09-10T08:00:00.000Z",
  views: 1000,
  likes: 10,
  comments: 2,
  durationSeconds: 30,
  thumbnailSeed: "analysis",
  topic: "testing",
  format: "reel",
  transcript: "Hook. Beweis.",
  transcriptStatus: "ready",
};

test("Convex queues at the signal write boundary and settles one claimed result", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.signals.bulkUpsert, { records: [signal] });
  const first = await t.query(api.transcriptAnalyses.list, { signalId: signal.id });
  expect(first).toHaveLength(1);
  await t.mutation(api.signals.bulkUpsert, { records: [signal] });
  expect(await t.query(api.transcriptAnalyses.list, { signalId: signal.id })).toHaveLength(1);

  const claimed = await t.mutation(api.transcriptAnalyses.claim, {
    now: "2026-09-10T10:00:00.000Z",
    claimId: "claim-1",
  });
  expect(claimed?.status).toBe("running");
  const settled = await t.mutation(api.transcriptAnalyses.settle, {
    id: first[0].id,
    claimId: "claim-1",
    status: "complete",
    now: "2026-09-10T10:01:00.000Z",
    framework: "pas",
    findings: [{ feature: "hook", explanation: "Einstieg", quote: "Hook.", start: 0, end: 5 }],
    chunks: [{ index: 0, start: 0, end: 13, status: "complete" }],
    textLength: 13,
    complete: true,
  });
  expect(settled?.status).toBe("complete");
  expect(settled?.findings[0].quote).toBe("Hook.");
});

test("Convex atomically reclaims an expired job and rejects the earlier worker", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.signals.bulkUpsert, { records: [{ ...signal, id: "ig-expired" }] });
  const [queued] = await t.query(api.transcriptAnalyses.list, { signalId: "ig-expired" });
  await t.mutation(api.transcriptAnalyses.claim, { now: "2026-09-10T10:00:00.000Z", claimId: "old-worker" });
  expect(await t.mutation(api.transcriptAnalyses.claim, { now: "2026-09-10T10:09:59.999Z", claimId: "early-worker" })).toBeNull();
  const reclaimed = await t.mutation(api.transcriptAnalyses.claim, { now: "2026-09-10T10:10:00.000Z", claimId: "new-worker" });
  expect(reclaimed?.attempts).toBe(2);
  expect(await t.mutation(api.transcriptAnalyses.settle, {
    id: queued.id,
    claimId: "old-worker",
    status: "complete",
    now: "2026-09-10T10:10:01.000Z",
  })).toBeNull();
});

test("Convex keeps a late result from replacing a newer working copy", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.signals.bulkUpsert, { records: [{ ...signal, id: "ig-stale" }] });
  const [queued] = await t.query(api.transcriptAnalyses.list, { signalId: "ig-stale" });
  await t.mutation(api.transcriptAnalyses.claim, { now: "2026-09-10T10:00:00.000Z", claimId: "stale-worker" });
  await t.mutation(api.signals.patchTranscript, {
    id: "ig-stale",
    patch: { transcriptWorkingCopy: "Eine neuere Arbeitsfassung.", transcriptUpdatedAt: "2026-09-10T10:00:01.000Z" },
  });
  expect(await t.mutation(api.transcriptAnalyses.settle, {
    id: queued.id,
    claimId: "stale-worker",
    status: "complete",
    now: "2026-09-10T10:00:02.000Z",
  })).toBeNull();
  const analyses = await t.query(api.transcriptAnalyses.list, { signalId: "ig-stale" });
  expect(analyses).toHaveLength(2);
  expect(analyses.find((item) => item.id === queued.id)?.status).toBe("running");
});
