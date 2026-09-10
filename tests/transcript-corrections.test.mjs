import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTranscriptCorrectionAction,
  buildTranscriptWorkingCopy,
  countTranscriptOccurrences,
  mergeCorrectionSuggestions,
  parseTranscriptCorrectionAction,
  parseTranscriptCorrectionResponse,
  transcriptCorrectionFields,
} from "../lib/transcript-corrections.ts";

const transcript = "Chris zeigt Notion. Notion bleibt im Repository.";
const base = {
  id: "signal-1",
  creatorId: "creator-1",
  title: "Reel",
  publishedAt: "2026-08-31T00:00:00.000Z",
  views: 10,
  likes: 1,
  comments: 1,
  durationSeconds: 10,
  thumbnailSeed: "seed",
  topic: "tools",
  format: "reel",
  transcript,
  transcriptStatus: "ready",
};

test("the working copy replaces every literal occurrence and keeps the original untouched", () => {
  const corrections = [
    { id: "c1", original: "Notion", replacement: "Notion AI", reason: "Tool name", source: "bridge", status: "accepted", createdAt: "now" },
    { id: "c2", original: "Repository", replacement: "Repository", reason: "same", source: "bridge", status: "proposed", createdAt: "now" },
  ];
  assert.equal(countTranscriptOccurrences(transcript, "Notion"), 2);
  assert.equal(buildTranscriptWorkingCopy(transcript, corrections), "Chris zeigt Notion AI. Notion AI bleibt im Repository.");
  assert.equal(buildTranscriptWorkingCopy(transcript, corrections.filter((item) => item.status !== "accepted")), undefined);
});

test("the Bridge response drops missing, empty, duplicate and overlong suggestions", () => {
  const parsed = parseTranscriptCorrectionResponse({
    corrections: [
      { original: "Notion", replacement: "Notion AI", reason: "Tool name" },
      { original: "Notion", replacement: "Something else", reason: "duplicate" },
      { original: "missing", replacement: "x", reason: "not in source" },
      { original: "", replacement: "x", reason: "empty" },
      { original: "Repository", replacement: "Repo", reason: "too obvious" },
    ],
  }, transcript, { now: "2026-08-31T10:00:00.000Z", idFactory: (index) => `bridge-${index}` });
  assert.deepEqual(parsed.map((item) => item.original), ["Notion", "Repository"]);
  assert.equal(parsed[0].id, "bridge-0");
  assert.match(parsed[0].reason, /2/);
  assert.equal(parsed[0].status, "proposed");
  assert.equal(parsed[0].source, "bridge");
});

test("suggestions preserve existing decisions when the Bridge is asked again", () => {
  const existing = {
    ...base,
    transcriptCorrections: [{ id: "accepted", original: "Notion", replacement: "Notion AI", reason: "kept", source: "bridge", status: "accepted", createdAt: "old" }],
    transcriptWorkingCopy: "Chris zeigt Notion AI. Notion AI bleibt im Repository.",
  };
  const next = mergeCorrectionSuggestions(existing, [{ id: "new", original: "Notion", replacement: "wrong", reason: "new", source: "bridge", status: "proposed", createdAt: "new" }]);
  assert.equal(next.transcriptCorrections.length, 1);
  assert.equal(next.transcriptCorrections[0].status, "accepted");
  assert.equal(next.transcriptWorkingCopy, existing.transcriptWorkingCopy);
});

test("accept, edit and reject all recompute the materialized fields", () => {
  const signal = {
    ...base,
    transcriptCorrections: [
      { id: "c1", original: "Notion", replacement: "Notion AI", reason: "Tool name", source: "bridge", status: "proposed", createdAt: "now" },
      { id: "c2", original: "Repository", replacement: "Repo", reason: "Repository name", source: "bridge", status: "accepted", createdAt: "now" },
    ],
  };
  const accepted = applyTranscriptCorrectionAction(signal, { id: signal.id, correctionId: "c1", action: "accept" });
  assert.equal(accepted.transcriptWorkingCopy, "Chris zeigt Notion AI. Notion AI bleibt im Repo.");
  const edited = applyTranscriptCorrectionAction(accepted, { id: signal.id, correctionId: "c1", action: "edit", replacement: "Notion Pro" });
  assert.equal(edited.transcriptWorkingCopy, "Chris zeigt Notion Pro. Notion Pro bleibt im Repo.");
  const rejected = applyTranscriptCorrectionAction(edited, { id: signal.id, correctionId: "c2", action: "reject" });
  assert.equal(rejected.transcriptWorkingCopy, "Chris zeigt Notion Pro. Notion Pro bleibt im Repository.");
  assert.equal(rejected.transcriptCorrections.find((item) => item.id === "c2").status, "rejected");
});

test("no accepted correction means no working-copy field, while the review list stays stored", () => {
  assert.deepEqual(transcriptCorrectionFields(transcript, [{ id: "c", original: "Notion", replacement: "Notion AI", reason: "x", source: "bridge", status: "proposed", createdAt: "now" }]), {
    transcriptWorkingCopy: null,
    transcriptCorrections: [{ id: "c", original: "Notion", replacement: "Notion AI", reason: "x", source: "bridge", status: "proposed", createdAt: "now" }],
  });
});

test("the PATCH parser accepts the five review actions", () => {
  assert.deepEqual(parseTranscriptCorrectionAction({ id: " signal-1 ", correctionId: " c1 ", action: "accept" }), { id: "signal-1", correctionId: "c1", action: "accept" });
  assert.deepEqual(parseTranscriptCorrectionAction({ id: "signal-1", correctionId: "c1", action: "edit", replacement: "Notion AI" }), { id: "signal-1", correctionId: "c1", action: "edit", replacement: "Notion AI" });
  assert.deepEqual(parseTranscriptCorrectionAction({ id: "signal-1", correctionId: "c1", action: "dictionary" }), { id: "signal-1", correctionId: "c1", action: "dictionary" });
  assert.deepEqual(parseTranscriptCorrectionAction({ id: "signal-1", correctionId: "c1", action: "remove-dictionary" }), { id: "signal-1", correctionId: "c1", action: "remove-dictionary" });
  assert.throws(() => parseTranscriptCorrectionAction({ id: "signal-1", correctionId: "c1", action: "edit" }), /replacement required/);
  assert.throws(() => parseTranscriptCorrectionAction({ id: "signal-1", correctionId: "c1", action: "dictionary", replacement: "Notion AI" }), /does not accept/);
  assert.throws(() => parseTranscriptCorrectionAction({ id: "signal-1", correctionId: "c1", action: "approve" }), /action must be/);
});
