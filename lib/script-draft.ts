import { SCRIPT_COPY_SENTENCE_MIN_WORDS } from "./config.ts";
import type { ScriptDraftAnswer, ScriptDraftRequest, ScriptSection } from "./contracts.ts";
import { parseScriptSections } from "./scripts.ts";

/** Raised before storage when generated wording repeats a supplied source sentence. */
export class ScriptCopyError extends Error {
  readonly sentence: string;

  constructor(sentence: string) {
    super(`Draft rejected because this sentence copies source material: "${sentence}"`);
    this.name = "ScriptCopyError";
    this.sentence = sentence;
  }
}

/** Fixed synthetic Draft used only while the backing store is empty. */
export function demoScriptDraftSections(hook: string): ScriptSection[] {
  return parseScriptSections([
    { kind: "hook", label: "Hook", text: hook },
    { kind: "beat", label: "Ausgangslage", text: "Ein Ergebnis wirkt beliebig, wenn der Weg dorthin unsichtbar bleibt." },
    { kind: "transition", label: "Wendung", text: "Ein kleiner sichtbarer Zwischenschritt ändert die Prüfung." },
    { kind: "beat", label: "Beleg", text: "Zeige den Input, eine Entscheidung und die klare Abbruchregel." },
    { kind: "cta", label: "CTA", text: "Prüfe deinen nächsten Ablauf auf genau einen sichtbaren Beleg." },
  ]);
}

function normalized(value: string) {
  return value.toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
}

const PERIOD_SENTINEL = "\u0000";

function protectInternalPeriods(value: string) {
  return value
    .replace(/\b(?:[\p{L}]\.\s*){2,}/gu, (abbreviation) => abbreviation.replaceAll(".", PERIOD_SENTINEL))
    .replace(/\b(?:bzw|ca|etc|ggf|inkl|nr|prof|dr)\./giu, (abbreviation) => abbreviation.replace(".", PERIOD_SENTINEL))
    .replace(/(\d)\.(?=\d)/gu, `$1${PERIOD_SENTINEL}`);
}

function sentences(value: string) {
  const protectedValue = protectInternalPeriods(value);
  const matches = protectedValue.match(/[^.!?…]+(?:[.!?…]+["”’')\]]*)?|[^.!?…]+$/gu) ?? [];
  return matches
    .map((sentence) => sentence.replaceAll(PERIOD_SENTINEL, ".").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function wordCount(value: string) {
  return value.split(/\s+/u).filter(Boolean).length;
}

function sourceTexts(request: ScriptDraftRequest) {
  const items = [...(request.source ? [request.source] : []), ...request.evidence];
  return items.flatMap((item) => [item.transcript, item.caption]).filter((text): text is string => Boolean(text?.trim())).map(normalized);
}

/** Returns the first copied generated sentence, preserving the wording shown to the person. */
export function copiedScriptSentence(
  sections: readonly ScriptSection[],
  request: ScriptDraftRequest,
  minimumWords = SCRIPT_COPY_SENTENCE_MIN_WORDS,
): string | null {
  const sources = sourceTexts(request);
  for (const section of sections) {
    for (const sentence of sentences(section.text)) {
      if (wordCount(sentence) < minimumWords) continue;
      const candidate = normalized(sentence);
      if (sources.some((source) => source.includes(candidate))) return sentence;
    }
  }
  return null;
}

/** Validates the Bridge answer, enforces the selected Hook and checks every source sentence before storage. */
export function parseScriptDraftAnswer(
  value: unknown,
  request: ScriptDraftRequest,
): ScriptDraftAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Script Draft answer must be an object.");
  }
  const rawSections = (value as { sections?: unknown }).sections;
  const rawHook = Array.isArray(rawSections)
    ? rawSections.find((section) => section && typeof section === "object" && !Array.isArray(section) && (section as { kind?: unknown }).kind === "hook")
    : undefined;
  if (!rawHook || (rawHook as { text?: unknown }).text !== request.selectedHook.hook) {
    throw new Error("The Hook section must match the selected Hook verbatim.");
  }
  if (
    !Array.isArray(rawSections)
    || (rawSections[0] as { kind?: unknown } | undefined)?.kind !== "hook"
    || (rawSections.at(-1) as { kind?: unknown } | undefined)?.kind !== "cta"
  ) {
    throw new Error("A Script Draft must start with the Hook and end with the CTA.");
  }
  const sections = parseScriptSections(rawSections);
  const copied = copiedScriptSentence(sections, request);
  if (copied) throw new ScriptCopyError(copied);
  return {
    sections: sections.map((section) => section.kind === "hook" ? { ...section, text: request.selectedHook.hook } : section),
  };
}
