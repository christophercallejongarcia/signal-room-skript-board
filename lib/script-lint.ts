import type { Script, ScriptLintSection, ScriptLintSuggestion } from "./contracts";
import { patchScript } from "./scripts.ts";

/** Bounds for the untrusted Lektorat Bridge boundary. */
export const SCRIPT_LINT_SECTION_ID_MAX = 200;
export const SCRIPT_LINT_SECTION_LABEL_MAX = 200;
export const SCRIPT_LINT_TEXT_MAX = 1_200;
export const SCRIPT_LINT_SUGGESTION_MAX = 120;
export const SCRIPT_LINT_REASON_MAX = 240;
export const SCRIPT_LINT_LIMIT = 20;

function boundedText(value: unknown, max: number) {
  return typeof value === "string"
    ? value
      .replace(/\r\n?/g, "\n")
      .replace(/[^\S\n]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((part) => part.trim())
      .join("\n")
      .trim()
      .slice(0, max)
    : "";
}

function boundedLine(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Stable ids for the ordered Script section list. They are not stored on sections. */
export function scriptSectionId(sectionIndex: number) {
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0) throw new Error(`Unknown script section ${sectionIndex}.`);
  return `section-${sectionIndex + 1}`;
}

/** Builds the bounded Bridge packet without exposing the stored Script object. */
export function scriptLintSections(script: Pick<Script, "sections">): ScriptLintSection[] {
  return script.sections.map((section, index) => ({
    id: scriptSectionId(index),
    label: boundedLine(section.label, SCRIPT_LINT_SECTION_LABEL_MAX),
    text: boundedText(section.text, SCRIPT_LINT_TEXT_MAX),
  }));
}

function countOccurrences(text: string, original: string) {
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

/** Applies the literal replacement to every occurrence in one section. */
export function applyScriptLintReplacement(text: string, original: string, replacement: string) {
  return original ? text.split(original).join(replacement) : text;
}

/** Validates untrusted Bridge output and drops suggestions without a literal fundstelle. */
export function parseScriptLintResponse(value: unknown, sections: readonly ScriptLintSection[]): ScriptLintSuggestion[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Lektorat response must be an object.");
  const rawSuggestions = (value as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(rawSuggestions)) throw new Error("Lektorat response needs a suggestions list.");

  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const seen = new Set<string>();
  const parsed: ScriptLintSuggestion[] = [];
  for (const raw of rawSuggestions.slice(0, SCRIPT_LINT_LIMIT)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const sectionId = boundedLine(item.sectionId, SCRIPT_LINT_SECTION_ID_MAX);
    const section = sectionById.get(sectionId);
    const original = boundedText(item.original, SCRIPT_LINT_SUGGESTION_MAX);
    const replacement = boundedText(item.replacement, SCRIPT_LINT_SUGGESTION_MAX);
    const reason = boundedLine(item.reason, SCRIPT_LINT_REASON_MAX);
    const key = `${sectionId}\u0000${original}`;
    if (
      !section
      || !original
      || !replacement
      || !reason
      || original === replacement
      || countOccurrences(section.text, original) === 0
      || seen.has(key)
    ) continue;
    seen.add(key);
    parsed.push({ sectionId, original, replacement, reason });
  }
  return parsed;
}

/** Accepts one suggestion manually and advances the Script revision exactly once. */
export function applyScriptLintSuggestion(script: Script, suggestion: ScriptLintSuggestion, now: string): Script {
  if (script.runId) throw new Error("A Script cannot be edited while a run is in progress.");
  const index = script.sections.findIndex((_, sectionIndex) => scriptSectionId(sectionIndex) === suggestion.sectionId);
  if (index < 0) throw new Error(`Unknown Lektorat section ${suggestion.sectionId}.`);
  const section = script.sections[index];
  if (countOccurrences(section.text, suggestion.original) === 0) {
    throw new Error("The Lektorat suggestion no longer occurs in this section.");
  }
  const sections = script.sections.map((candidate, candidateIndex) => candidateIndex === index
    ? { ...candidate, text: applyScriptLintReplacement(candidate.text, suggestion.original, suggestion.replacement) }
    : { ...candidate });
  return patchScript(script, { sections }, now);
}
