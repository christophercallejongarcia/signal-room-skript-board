import type { SignalRecord, TranscriptCorrection, TranscriptDictionaryEntry, TranscriptPatch } from "./contracts";

/** Bounds for the human-reviewable correction boundary. */
export const TRANSCRIPT_CORRECTION_MAX = 120;
export const TRANSCRIPT_CORRECTION_REASON_MAX = 240;
export const TRANSCRIPT_CORRECTION_LIMIT = 20;
export const TRANSCRIPT_CORRECTION_TRANSCRIPT_MAX = 30_000;

const CORRECTION_SOURCES = ["bridge", "dictionary"] as const;
const CORRECTION_STATUSES = ["proposed", "accepted", "rejected"] as const;

export type TranscriptCorrectionAction = {
  id: string;
  correctionId: string;
  action: "accept" | "edit" | "reject" | "dictionary" | "remove-dictionary";
  replacement?: string;
};

export type TranscriptCorrectionRequest = { id: string };

export type TranscriptCorrectionResponseOptions = {
  now?: string;
  idFactory?: (index: number) => string;
};

function bounded(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Counts non-overlapping literal occurrences, matching the replacement behavior. */
export function countTranscriptOccurrences(text: string, original: string) {
  if (!text || !original) return 0;
  let count = 0;
  let from = 0;
  while (from < text.length) {
    const found = text.indexOf(original, from);
    if (found < 0) break;
    count += 1;
    from = found + original.length;
  }
  return count;
}

/** Applies one accepted correction to every literal occurrence in the text. */
export function applyAcceptedCorrection(text: string, correction: Pick<TranscriptCorrection, "original" | "replacement">) {
  return correction.original ? text.split(correction.original).join(correction.replacement) : text;
}

/** Builds the working copy from the original only. Rejected and proposed items do not change it. */
export function buildTranscriptWorkingCopy(
  original: string | undefined,
  corrections: readonly TranscriptCorrection[] = [],
) {
  const source = original ?? "";
  const accepted = corrections.filter((correction) => correction.status === "accepted" && correction.original && correction.replacement);
  if (!source || accepted.length === 0) return undefined;
  return accepted.reduce(applyAcceptedCorrection, source);
}

/** All stored correction fields, materialized from the same pure working-copy function. */
export function transcriptCorrectionFields(
  original: string | undefined,
  corrections: readonly TranscriptCorrection[],
): TranscriptPatch {
  const boundedCorrections = corrections.slice(0, TRANSCRIPT_CORRECTION_LIMIT);
  const workingCopy = buildTranscriptWorkingCopy(original, boundedCorrections);
  return {
    transcriptWorkingCopy: workingCopy ?? null,
    transcriptCorrections: boundedCorrections.length > 0 ? boundedCorrections : null,
  };
}

/** Applies a correction-layer patch without carrying null into SignalRecord's optional fields. */
function applyCorrectionPatch(signal: SignalRecord, patch: TranscriptPatch): SignalRecord {
  const next = { ...signal };
  if (patch.transcriptWorkingCopy === null) delete next.transcriptWorkingCopy;
  else if (patch.transcriptWorkingCopy !== undefined) next.transcriptWorkingCopy = patch.transcriptWorkingCopy;
  if (patch.transcriptCorrections === null) delete next.transcriptCorrections;
  else if (patch.transcriptCorrections !== undefined) next.transcriptCorrections = patch.transcriptCorrections;
  return next;
}

function correctionReason(reason: string, count: number) {
  const base = bounded(reason, TRANSCRIPT_CORRECTION_REASON_MAX);
  if (count <= 1 || base.includes(String(count))) return base;
  const suffix = `Kommt ${count}× im Original vor.`;
  return `${base}${base ? " " : ""}${suffix}`.slice(0, TRANSCRIPT_CORRECTION_REASON_MAX);
}

function validCorrection(value: unknown): value is TranscriptCorrection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<TranscriptCorrection>;
  return (
    typeof item.id === "string" &&
    typeof item.original === "string" &&
    typeof item.replacement === "string" &&
    typeof item.reason === "string" &&
    CORRECTION_SOURCES.includes(item.source as (typeof CORRECTION_SOURCES)[number]) &&
    CORRECTION_STATUSES.includes(item.status as (typeof CORRECTION_STATUSES)[number]) &&
    typeof item.createdAt === "string"
  );
}

/** Parses the Bridge answer and drops suggestions without an exact source occurrence. */
export function parseTranscriptCorrectionResponse(
  value: unknown,
  transcript: string,
  options: TranscriptCorrectionResponseOptions = {},
): TranscriptCorrection[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Correction response must be an object.");
  const rawCorrections = (value as { corrections?: unknown }).corrections;
  if (!Array.isArray(rawCorrections)) throw new Error("Correction response needs a corrections list.");
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? ((index: number) => `correction-${index + 1}`);
  const seen = new Set<string>();
  const parsed: TranscriptCorrection[] = [];

  for (const raw of rawCorrections.slice(0, TRANSCRIPT_CORRECTION_LIMIT)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const original = bounded(item.original, TRANSCRIPT_CORRECTION_MAX);
    const replacement = bounded(item.replacement, TRANSCRIPT_CORRECTION_MAX);
    const reason = bounded(item.reason, TRANSCRIPT_CORRECTION_REASON_MAX);
    const occurrenceCount = countTranscriptOccurrences(transcript, original);
    if (!original || !replacement || !reason || replacement === original || occurrenceCount === 0 || seen.has(original)) continue;
    seen.add(original);
    parsed.push({
      id: idFactory(parsed.length),
      original,
      replacement,
      reason: correctionReason(reason, occurrenceCount),
      source: "bridge",
      status: "proposed",
      createdAt: now,
    });
  }
  return parsed;
}

/** Drops a Bridge proposal that disagrees with a known mapping for the same literal source. */
export function filterDictionaryContradictions(
  suggestions: readonly TranscriptCorrection[],
  dictionary: readonly TranscriptDictionaryEntry[] = [],
): TranscriptCorrection[] {
  return suggestions.filter((suggestion) => {
    const known = dictionary.filter((entry) => entry.wrong === suggestion.original);
    return known.length === 0 || known.every((entry) => entry.right === suggestion.replacement);
  });
}

/** Adds fresh Bridge proposals without replacing a decision already made on this Signal. */
export function mergeCorrectionSuggestions(
  signal: SignalRecord,
  suggestions: TranscriptCorrection[],
  dictionary: readonly TranscriptDictionaryEntry[] = [],
): SignalRecord {
  const existing = signal.transcriptCorrections ?? [];
  const byOriginal = new Set(existing.map((correction) => correction.original));
  const corrections = [...existing];
  for (const suggestion of filterDictionaryContradictions(suggestions, dictionary)) {
    if (byOriginal.has(suggestion.original)) continue;
    byOriginal.add(suggestion.original);
    corrections.push(suggestion);
    if (corrections.length >= TRANSCRIPT_CORRECTION_LIMIT) break;
  }
  return applyCorrectionPatch(signal, transcriptCorrectionFields(signal.transcript, corrections));
}

/** Bounds and validates the body used by the app's correction-suggestion route. */
export function parseTranscriptCorrectionRequest(body: unknown): TranscriptCorrectionRequest {
  const input = (body ?? {}) as Record<string, unknown>;
  const id = bounded(input.id, 200);
  if (!id) throw new Error("id required");
  return { id };
}

/** Bounds and validates accept, edit and reject operations from the Reel view. */
export function parseTranscriptCorrectionAction(body: unknown): TranscriptCorrectionAction {
  const input = (body ?? {}) as Record<string, unknown>;
  const id = bounded(input.id, 200);
  const correctionId = bounded(input.correctionId, 200);
  const action = input.action;
  if (!id) throw new Error("id required");
  if (!correctionId) throw new Error("correctionId required");
  if (action !== "accept" && action !== "edit" && action !== "reject" && action !== "dictionary" && action !== "remove-dictionary") {
    throw new Error("action must be accept, edit, reject, dictionary or remove-dictionary");
  }
  const replacement = input.replacement === undefined ? undefined : bounded(input.replacement, TRANSCRIPT_CORRECTION_MAX);
  if (action === "edit" && !replacement) throw new Error("replacement required for edit");
  if ((action === "dictionary" || action === "remove-dictionary") && replacement !== undefined) {
    throw new Error(`${action} does not accept a replacement`);
  }
  return { id, correctionId, action, ...(replacement ? { replacement } : {}) };
}

/** Applies one review action and recomputes the materialized working copy. */
export function applyTranscriptCorrectionAction(
  signal: SignalRecord,
  action: TranscriptCorrectionAction,
): SignalRecord {
  const corrections = signal.transcriptCorrections ?? [];
  const index = corrections.findIndex((correction) => correction.id === action.correctionId);
  if (index < 0) throw new Error(`unknown correction ${action.correctionId}`);
  const current = corrections[index];
  if (action.action === "dictionary" || action.action === "remove-dictionary") return signal;
  const next = {
    ...current,
    ...(action.action === "edit" ? { replacement: action.replacement! } : {}),
    status: action.action === "reject" ? "rejected" : "accepted",
  } satisfies TranscriptCorrection;
  const updated = corrections.map((correction, correctionIndex) => (correctionIndex === index ? next : correction));
  return applyCorrectionPatch(signal, transcriptCorrectionFields(signal.transcript, updated));
}

/** Used by a new transcript Actor run. The original remains, the derived review layer does not. */
export function clearTranscriptCorrectionsPatch(): TranscriptPatch {
  return { transcriptWorkingCopy: null, transcriptCorrections: null };
}

/** Type guard for old file-store rows before their correction fields are trusted. */
export function isTranscriptCorrection(value: unknown): value is TranscriptCorrection {
  return validCorrection(value);
}
