import type { SignalRecord } from "./contracts";

/** Longest spoken hook kept, in characters. */
export const SPOKEN_HOOK_MAX = 120;

/**
 * The hook of a caption: its first non-empty line, leading decoration removed.
 * Emoji and punctuation are stripped from the front only, so a closing question
 * mark survives.
 */
export function hookLine(caption: string | undefined) {
  const line = (caption ?? "").split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return line.replace(/^[^\p{L}\p{Nd}]+/u, "").replace(/\s+/g, " ").trim();
}

/**
 * The first sentence of a transcript, decoration stripped, cut at a word
 * boundary past SPOKEN_HOOK_MAX. The spoken first seconds are the Hook of a
 * reel whose caption is often empty or an emoji line. A full stop after a
 * digit ("2. Tipp") is an ordinal, not a sentence end.
 */
export function spokenHook(transcript: string) {
  const flat = transcript.replace(/\s+/g, " ").trim().replace(/^[^\p{L}\p{Nd}]+/u, "");
  const sentence = flat.match(/^.*?(?:[!?]|(?<!\p{Nd})\.)(?=\s|$)/u)?.[0] ?? flat;
  if (sentence.length <= SPOKEN_HOOK_MAX) return sentence;
  const cut = sentence.slice(0, SPOKEN_HOOK_MAX);
  return `${(cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trimEnd()}…`;
}

/** What hookOf reads: the working copy, then original transcript, then caption, then title. */
export type HookSource = Pick<SignalRecord, "transcript" | "transcriptWorkingCopy" | "caption" | "title">;

/**
 * The Hook of a signal, decided here and nowhere else: the spoken hook from the
 * working copy when one exists, otherwise the original transcript, then the
 * first caption line and finally the title.
 */
export function hookOf(signal: HookSource) {
  const transcript = signal.transcriptWorkingCopy?.trim() || signal.transcript;
  const spoken = transcript ? spokenHook(transcript) : "";
  return spoken || hookLine(signal.caption ?? signal.title);
}
