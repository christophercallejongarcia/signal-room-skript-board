import type { Script, Storyboard } from "./contracts";
import { parseStoryboard } from "./ideas.ts";

export class StoryboardDuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryboardDuplicateError";
  }
}

/** A normalized identity used only to reject exact cross-field repetitions. */
function normalized(value: string) {
  return value.toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
}

function scriptHook(script: Pick<Script, "sections">) {
  const hooks = script.sections.filter((section) => section.kind === "hook");
  if (hooks.length !== 1) throw new Error("An approved Script needs exactly one Hook section.");
  const hook = hooks[0].text.trim();
  if (!hook) throw new Error("The approved Script Hook is empty.");
  return hook;
}

/**
 * Parses the untrusted Bridge answer, pins its Hook to the approved Script and
 * rejects exact repetitions between spoken Storyboard fields and Caption lines.
 */
export function parseScriptStoryboardAnswer(
  value: unknown,
  script: Pick<Script, "id" | "revision" | "sections">,
): Storyboard {
  const parsed = parseStoryboard(value);
  const hook = scriptHook(script);
  const comparable = [
    { label: "Hook", text: hook },
    ...parsed.beats.map((beat, index) => ({ label: `Beat ${index + 1}`, text: beat.detail })),
    { label: "CTA", text: parsed.cta },
    ...parsed.caption
      .split("\n")
      .map((text, index) => ({ label: `Caption line ${index + 1}`, text: text.trim() }))
      .filter((item) => item.text),
  ];
  const seen = new Map<string, string>();
  for (const item of comparable) {
    const identity = normalized(item.text);
    const previous = seen.get(identity);
    if (previous) throw new StoryboardDuplicateError(`${item.label} duplicates ${previous === "Hook" ? "the Hook" : previous}.`);
    seen.set(identity, item.label);
  }

  return {
    ...parsed,
    scriptId: script.id,
    scriptRevision: script.revision,
    hook,
    commentCta: "",
    leadMagnetCta: "",
  };
}

export function isLegacyStoryboard(storyboard: Storyboard) {
  return !storyboard.scriptId;
}

/** A newly approved revision makes the attached Storyboard visibly stale. */
export function isStoryboardOutdated(storyboard: Storyboard, script: Pick<Script, "id" | "approvedRevision"> | undefined) {
  return Boolean(
    storyboard.scriptId
    && script?.id === storyboard.scriptId
    && script.approvedRevision !== undefined
    && storyboard.scriptRevision !== script.approvedRevision,
  );
}
