import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTranscriptDictionary,
  mergeTranscriptDictionaryEntries,
  removeTranscriptDictionaryEntry,
} from "../lib/transcript-dictionary.ts";
import {
  applyTranscriptCorrectionAction,
  mergeCorrectionSuggestions,
} from "../lib/transcript-corrections.ts";

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
  transcript: "Chris zeigt Notion. Notion bleibt im Repository.",
  transcriptStatus: "ready",
};

test("dictionary hits become accepted reel-local corrections before the Bridge", () => {
  const dictionary = [
    { wrong: "Notion", right: "Notion AI", createdAt: "2026-08-31T10:00:00.000Z" },
  ];
  const next = applyTranscriptDictionary(base, dictionary, {
    now: "2026-08-31T12:00:00.000Z",
    idFactory: (entry) => `dictionary-${entry.wrong}`,
  });

  assert.deepEqual(next.transcriptCorrections, [{
    id: "dictionary-Notion",
    original: "Notion",
    replacement: "Notion AI",
    reason: "Aus dem persönlichen Wörterbuch. Kommt 2× im Original vor.",
    source: "dictionary",
    status: "accepted",
    createdAt: "2026-08-31T12:00:00.000Z",
  }]);
  assert.equal(next.transcriptWorkingCopy, "Chris zeigt Notion AI. Notion AI bleibt im Repository.");
  assert.equal(next.transcript, base.transcript);
});

test("remembering a mapping merges duplicate entries and keeps one current mapping", () => {
  const initial = [{ wrong: "Thumnail", right: "Thumbnail", createdAt: "2026-08-30T10:00:00.000Z" }];
  const merged = mergeTranscriptDictionaryEntries(initial, {
    wrong: "  Thumnail ",
    right: " Thumbnail ",
    createdAt: "2026-08-31T10:00:00.000Z",
  });

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], { wrong: "Thumnail", right: "Thumbnail", createdAt: "2026-08-31T10:00:00.000Z" });
  assert.deepEqual(removeTranscriptDictionaryEntry(merged, merged[0]), []);
});

test("a Bridge proposal that contradicts the dictionary is discarded", () => {
  const dictionary = [{ wrong: "Notion", right: "Notion AI", createdAt: "now" }];
  const signal = applyTranscriptDictionary(base, dictionary, { idFactory: (entry) => `dictionary-${entry.wrong}` });
  const next = mergeCorrectionSuggestions(signal, [{
    id: "bridge-1",
    original: "Notion",
    replacement: "Motion",
    reason: "likely recognition error",
    source: "bridge",
    status: "proposed",
    createdAt: "now",
  }], dictionary);

  assert.equal(next.transcriptCorrections.length, 1);
  assert.equal(next.transcriptCorrections[0].source, "dictionary");
});

test("rejecting a dictionary correction changes only this Reel", () => {
  const dictionary = [{ wrong: "Notion", right: "Notion AI", createdAt: "now" }];
  const signal = applyTranscriptDictionary(base, dictionary, { idFactory: (entry) => `dictionary-${entry.wrong}` });
  const rejected = applyTranscriptCorrectionAction(signal, {
    id: signal.id,
    correctionId: "dictionary-Notion",
    action: "reject",
  });

  assert.equal(rejected.transcriptCorrections[0].status, "rejected");
  assert.equal(rejected.transcriptWorkingCopy, undefined);
  assert.deepEqual(dictionary, [{ wrong: "Notion", right: "Notion AI", createdAt: "now" }]);
});
