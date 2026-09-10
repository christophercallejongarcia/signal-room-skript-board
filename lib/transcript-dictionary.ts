import type { SignalRecord, TranscriptCorrection, TranscriptDictionaryEntry, TranscriptPatch } from "./contracts";
import {
  TRANSCRIPT_CORRECTION_LIMIT,
  TRANSCRIPT_CORRECTION_MAX,
  countTranscriptOccurrences,
  transcriptCorrectionFields,
} from "./transcript-corrections.ts";

/** The dictionary is personal text input, so it gets the same bound as a correction. */
export const TRANSCRIPT_DICTIONARY_MAX = TRANSCRIPT_CORRECTION_MAX;
/** A bounded query keeps the global dictionary from becoming an unbounded prompt input. */
export const TRANSCRIPT_DICTIONARY_LIMIT = 500;

export type TranscriptDictionaryInput = Pick<TranscriptDictionaryEntry, "wrong" | "right"> & {
  createdAt?: string;
};

export type ApplyTranscriptDictionaryOptions = {
  now?: string;
  idFactory?: (entry: TranscriptDictionaryEntry, index: number) => string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, TRANSCRIPT_DICTIONARY_MAX) : "";
}

/** Keeps one current mapping per wrong transcription. Later input wins conflicts. */
export function normalizeTranscriptDictionary(entries: readonly TranscriptDictionaryInput[]): TranscriptDictionaryEntry[] {
  const byWrong = new Map<string, TranscriptDictionaryEntry>();
  for (const entry of entries) {
    const wrong = clean(entry.wrong);
    const right = clean(entry.right);
    if (!wrong || !right || wrong === right) continue;
    const createdAt = typeof entry.createdAt === "string" && entry.createdAt.trim() ? entry.createdAt : new Date(0).toISOString();
    byWrong.set(wrong, { wrong, right, createdAt });
  }
  return [...byWrong.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.wrong.localeCompare(b.wrong))
    .slice(0, TRANSCRIPT_DICTIONARY_LIMIT);
}

/** Adds one mapping idempotently and merges an existing mapping with the same wrong text. */
export function mergeTranscriptDictionaryEntries(
  entries: readonly TranscriptDictionaryInput[],
  entry: TranscriptDictionaryInput,
): TranscriptDictionaryEntry[] {
  return normalizeTranscriptDictionary([...entries, entry]);
}

/** Removes one exact mapping without changing the input array. */
export function removeTranscriptDictionaryEntry(
  entries: readonly TranscriptDictionaryEntry[],
  entry: Pick<TranscriptDictionaryEntry, "wrong" | "right">,
): TranscriptDictionaryEntry[] {
  return entries.filter((candidate) => !(candidate.wrong === entry.wrong && candidate.right === entry.right));
}

function correctionReason(count: number) {
  return count > 1
    ? `Aus dem persönlichen Wörterbuch. Kommt ${count}× im Original vor.`
    : "Aus dem persönlichen Wörterbuch.";
}

function withCorrectionFields(signal: SignalRecord, fields: TranscriptPatch): SignalRecord {
  const next = { ...signal };
  if (fields.transcriptWorkingCopy === null) delete next.transcriptWorkingCopy;
  else if (fields.transcriptWorkingCopy !== undefined) next.transcriptWorkingCopy = fields.transcriptWorkingCopy;
  if (fields.transcriptCorrections === null) delete next.transcriptCorrections;
  else if (fields.transcriptCorrections !== undefined) next.transcriptCorrections = fields.transcriptCorrections;
  return next;
}

/** Creates accepted, reel-local corrections for dictionary words found literally in the original. */
export function applyTranscriptDictionary(
  signal: SignalRecord,
  entries: readonly TranscriptDictionaryInput[],
  options: ApplyTranscriptDictionaryOptions = {},
): SignalRecord {
  const original = signal.transcript ?? "";
  const existing = signal.transcriptCorrections ?? [];
  const dictionary = normalizeTranscriptDictionary(entries);
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? ((entry: TranscriptDictionaryEntry, index: number) => `dictionary-${index + 1}-${entry.wrong}`);
  const corrections = [...existing];
  let changed = false;

  for (const [index, entry] of dictionary.entries()) {
    const occurrences = countTranscriptOccurrences(original, entry.wrong);
    if (!occurrences) continue;
    const correction: TranscriptCorrection = {
      id: idFactory(entry, index),
      original: entry.wrong,
      replacement: entry.right,
      reason: correctionReason(occurrences),
      source: "dictionary",
      status: "accepted",
      createdAt: now,
    };
    const currentIndex = corrections.findIndex((item) => item.original === entry.wrong);
    if (currentIndex >= 0) {
      // An explicit rejection is local to the Reel and must win over the global mapping.
      const current = corrections[currentIndex];
      if (current.status === "rejected") continue;
      // A human decision on this Reel remains authoritative if the global mapping changes.
      if (current.status === "accepted") continue;
      if (
        current.original !== correction.original
        || current.replacement !== correction.replacement
        || current.source !== correction.source
        || current.status !== correction.status
      ) {
        corrections[currentIndex] = correction;
        changed = true;
      }
      continue;
    }
    if (corrections.length >= TRANSCRIPT_CORRECTION_LIMIT) break;
    corrections.push(correction);
    changed = true;
  }

  if (!changed) return signal;
  return withCorrectionFields(signal, transcriptCorrectionFields(original, corrections.slice(0, TRANSCRIPT_CORRECTION_LIMIT)));
}

/** Alias used by callers that describe the same operation as applying dictionary corrections. */
export const applyDictionaryCorrections = applyTranscriptDictionary;
