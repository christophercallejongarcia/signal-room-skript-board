import type {
  Idea,
  Script,
  ScriptFramework,
  ScriptFrameworkDefinition,
  ScriptHookEvidenceItem,
  ScriptHookOption,
  ScriptHooksAnswer,
  ScriptPatch,
  ScriptRunClaimOptions,
  ScriptSection,
  ScriptStatus,
  SettleScriptRun,
} from "./contracts";
import { ForbiddenMoveError } from "./ideas.ts";

export { ForbiddenMoveError } from "./ideas.ts";

/** Atomic conflict used when a run must not supersede another active run. */
export class ScriptRunConflictError extends Error {
  constructor(message = "This Script already has a run in progress.") {
    super(message);
    this.name = "ScriptRunConflictError";
  }
}

export const SCRIPT_STATUSES: readonly ScriptStatus[] = ["hook-selection", "draft", "review", "approved"];
export const SCRIPT_FRAMEWORKS: readonly ScriptFramework[] = ["pas", "bbb", "none"];
export const SCRIPT_SECTION_TEXT_MAX = 1200;
export const SCRIPT_HOOK_OPTION_MAX = 5;
export const SCRIPT_HOOK_MAX = 400;
export const SCRIPT_ANGLE_MAX = 500;
export const SCRIPT_HYPOTHESIS_MAX = 500;
export const SCRIPT_FIT_MAX = 500;
export const SCRIPT_SECTION_LABEL_MAX = 200;
export const SCRIPT_HOOK_OPTION_MIN = 3;
export const SCRIPT_HOOK_EVIDENCE_MAX = 3;
export const SCRIPT_SOURCE_TRANSCRIPT_MAX = 30_000;
export const SCRIPT_EVIDENCE_TRANSCRIPT_MAX = 4_000;
export const SCRIPT_EVIDENCE_LIMIT = 10;

/** The only frameworks the Hook run may recommend. Definitions travel in the packet. */
export const SCRIPT_FRAMEWORK_DEFINITIONS: readonly ScriptFrameworkDefinition[] = [
  {
    id: "pas",
    label: "PAS",
    definition: "Problem, Agitation, Solution: erst den Engpass zeigen, dann seine Folge zuspitzen und eine Lösung geben.",
    useWhen: "Wenn der Ansatz von einem klaren Schmerz oder einer spürbaren Reibung lebt.",
  },
  {
    id: "bbb",
    label: "BBB",
    definition: "Before, Bridge, After: Ausgangslage zeigen, den Übergang erklären und das veränderte Ergebnis sichtbar machen.",
    useWhen: "Wenn der Ansatz einen vorher-nachher-Weg oder eine konkrete Veränderung zeigt.",
  },
  {
    id: "none",
    label: "Keins",
    definition: "Kein festes Framework: Die natürliche Reihenfolge des Themas bleibt führend.",
    useWhen: "Wenn ein Framework die Spannung des Themas eher glätten als klären würde.",
  },
];

export type ScriptReadingParagraph = ScriptSection & {
  /** Index into the source-of-truth section list. */
  sectionIndex: number;
};

/** The fields a human editor may change through PATCH /api/scripts/<id>. */
/** A forbidden Script move uses the same public error type as an Idea move. */
export function canTransition(from: ScriptStatus, to: ScriptStatus): boolean {
  if (from === "approved") return to === "draft";
  if (from === "hook-selection") return false;
  if (from === "draft") return to === "review";
  return to === "draft" || to === "approved";
}

export const canScriptTransition = canTransition;

function requireTransition(from: ScriptStatus, to: ScriptStatus) {
  if (!canTransition(from, to)) {
    throw new ForbiddenMoveError(`A script cannot move from ${from} to ${to}.`);
  }
}

function line(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function requireText(value: unknown, message: string, max = 200) {
  const result = line(value, max);
  if (!result) throw new Error(message);
  return result;
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function sectionText(value: unknown) {
  const result = typeof value === "string"
    ? value
      .replace(/\r\n?/g, "\n")
      .replace(/[^\S\n]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((part) => part.trim())
      .join("\n")
      .trim()
      .slice(0, SCRIPT_SECTION_TEXT_MAX)
    : "";
  if (!result) throw new Error("Script section needs text.");
  return result;
}

/** Validates the section invariant shared by storage and future editor routes. */
export function parseScriptSections(value: unknown): ScriptSection[] {
  if (!Array.isArray(value)) throw new Error("Script sections must be an array.");

  const sections = value.map((raw, index) => {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const kind = source.kind;
    if (kind !== "hook" && kind !== "beat" && kind !== "transition" && kind !== "cta") {
      throw new Error(`Script section ${index + 1} has an invalid kind.`);
    }
    return {
      kind,
      label: requireText(source.label, `Script section ${index + 1} needs a label.`, SCRIPT_SECTION_LABEL_MAX),
      text: sectionText(source.text),
    } satisfies ScriptSection;
  });

  if (sections.filter((section) => section.kind === "hook").length !== 1) {
    throw new Error("A script needs exactly one hook section.");
  }
  if (sections.filter((section) => section.kind === "cta").length !== 1) {
    throw new Error("A script needs exactly one CTA section.");
  }
  const beats = sections.filter((section) => section.kind === "beat").length;
  if (beats < 2 || beats > 5) throw new Error("A script needs between two and five beat sections.");
  return sections;
}

/** Alias that reads naturally at call sites which already have typed sections. */
export const validateScriptSections = parseScriptSections;

/**
 * Builds the reading view without joining text into a second editable value.
 * Each paragraph keeps the index of its source section, so a reading-view edit
 * can write directly back to that section.
 */
export function renderScriptReadingView(sections: readonly ScriptSection[]): ScriptReadingParagraph[] {
  return sections.map((section, sectionIndex) => ({ ...section, sectionIndex }));
}

/** Purely updates one source section. It never parses or reverse-translates the reading view. */
export function updateScriptSection(
  sections: readonly ScriptSection[],
  sectionIndex: number,
  values: Partial<Pick<ScriptSection, "label" | "text">>,
): ScriptSection[] {
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= sections.length) {
    throw new Error(`Unknown script section ${sectionIndex}.`);
  }
  return sections.map((section, index) => {
    if (index !== sectionIndex) return { ...section };
    return {
      ...section,
      ...(hasOwn(values, "label") ? { label: typeof values.label === "string" ? values.label.slice(0, SCRIPT_SECTION_LABEL_MAX) : "" } : {}),
      ...(hasOwn(values, "text") ? { text: typeof values.text === "string" ? values.text.slice(0, SCRIPT_SECTION_TEXT_MAX) : "" } : {}),
    };
  });
}

/** Alias for callers that emphasize the reading-view write-back boundary. */
export const updateReadingViewSection = updateScriptSection;

function isScriptFramework(value: unknown): value is ScriptFramework {
  return typeof value === "string" && SCRIPT_FRAMEWORKS.includes(value as ScriptFramework);
}

function isScriptStatus(value: unknown): value is ScriptStatus {
  return typeof value === "string" && SCRIPT_STATUSES.includes(value as ScriptStatus);
}

/** Parses the bounded body of PATCH /api/scripts/<id>. */
export function parseScriptPatch(body: unknown): ScriptPatch {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const patch: ScriptPatch = {};
  if (hasOwn(input, "sections")) patch.sections = parseScriptSections(input.sections);
  if (hasOwn(input, "framework")) {
    if (!isScriptFramework(input.framework)) throw new Error(`framework must be one of ${SCRIPT_FRAMEWORKS.join(", ")}`);
    patch.framework = input.framework;
  }
  if (hasOwn(input, "status")) {
    if (!isScriptStatus(input.status)) throw new Error(`status must be one of ${SCRIPT_STATUSES.join(", ")}`);
    patch.status = input.status;
  }
  if (hasOwn(input, "evidenceSignalIds")) {
    patch.evidenceSignalIds = scriptIds(input.evidenceSignalIds).slice(0, SCRIPT_EVIDENCE_LIMIT);
  }
  if (hasOwn(input, "hookOptions")) patch.hookOptions = parseScriptHookOptions(input.hookOptions);
  if (hasOwn(input, "selectedHookId")) {
    if (input.selectedHookId !== null && typeof input.selectedHookId !== "string") {
      throw new Error("selectedHookId must be a string or null.");
    }
    patch.selectedHookId = input.selectedHookId === null ? null : line(input.selectedHookId, 200);
  }
  if (Object.keys(patch).length === 0) throw new Error("PATCH needs sections, framework, status, evidenceSignalIds, hookOptions or selectedHookId.");
  return patch;
}

/** Validates and bounds Hook-Options before a run result can enter storage. */
export function parseScriptHookOptions(value: unknown): ScriptHookOption[] {
  if (!Array.isArray(value)) throw new Error("Hook options must be an array.");
  return value.slice(0, SCRIPT_HOOK_OPTION_MAX).map((raw, index) => {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const framework = source.framework;
    if (typeof framework !== "string" || !SCRIPT_FRAMEWORKS.includes(framework as ScriptFramework)) {
      throw new Error(`Hook option ${index + 1} has an invalid framework.`);
    }
    const rawEvidence = source.evidence;
    if (!Array.isArray(rawEvidence)) throw new Error(`Hook option ${index + 1} needs evidence.`);
    const evidence = rawEvidence.slice(0, 10).map((item, evidenceIndex) => {
      const candidate = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      const outlier = typeof candidate.outlier === "number" && Number.isFinite(candidate.outlier) ? Math.max(0, candidate.outlier) : NaN;
      if (!Number.isFinite(outlier)) throw new Error(`Hook option ${index + 1} evidence ${evidenceIndex + 1} needs a number.`);
      return {
        signalId: requireText(candidate.signalId, `Hook option ${index + 1} evidence needs a Signal id.`),
        hook: requireText(candidate.hook, `Hook option ${index + 1} evidence needs a Hook.`, SCRIPT_HOOK_MAX),
        creator: requireText(candidate.creator, `Hook option ${index + 1} evidence needs a Creator.`, 120),
        outlier,
        fit: requireText(candidate.fit, `Hook option ${index + 1} evidence needs a fit reason.`, SCRIPT_FIT_MAX),
      };
    });
    return {
      id: requireText(source.id, `Hook option ${index + 1} needs an id.`),
      hook: requireText(source.hook, `Hook option ${index + 1} needs a Hook.`, SCRIPT_HOOK_MAX),
      angle: requireText(source.angle, `Hook option ${index + 1} needs an Angle.`, SCRIPT_ANGLE_MAX),
      hypothesis: requireText(source.hypothesis, `Hook option ${index + 1} needs a hypothesis.`, SCRIPT_HYPOTHESIS_MAX),
      framework: framework as ScriptFramework,
      evidence,
      edited: source.edited === true,
    };
  });
}

function titleKey(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 300).toLowerCase() : "";
}

function uniqueHookKey(value: string) {
  return value.toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
}

function resolveScriptHookEvidence(value: unknown, evidence: ScriptHookEvidenceItem[], optionIndex: number) {
  if (!Array.isArray(value)) throw new Error(`Hook option ${optionIndex + 1} needs an evidence list.`);
  const byTitle = new Map(evidence.map((item) => [titleKey(item.title), item]));
  const seen = new Set<string>();
  const resolved: ScriptHookOption["evidence"] = [];
  for (const raw of value.slice(0, SCRIPT_HOOK_EVIDENCE_MAX)) {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const title = titleKey(item.title);
    const match = title ? byTitle.get(title) : undefined;
    // A citation outside the packet is discarded. It must never become a stored Reel id.
    if (!match || seen.has(title)) continue;
    seen.add(title);
    resolved.push({
      signalId: match.id,
      hook: match.title,
      creator: match.creator,
      outlier: match.outlier,
      fit: requireText(item.fit, `Hook option ${optionIndex + 1} evidence needs a fit reason.`, SCRIPT_FIT_MAX),
    });
  }
  return resolved;
}

/** Validates a Script Hook answer and resolves every cited Reel against the accepted packet. */
export function parseScriptHooksAnswer(
  value: unknown,
  evidence: ScriptHookEvidenceItem[],
): { hookOptions: ScriptHookOption[]; framework: ScriptFramework; frameworkReason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Script Hooks answer must be an object.");
  }
  const answer = value as Partial<ScriptHooksAnswer> & Record<string, unknown>;
  if (!Array.isArray(answer.options) || answer.options.length < SCRIPT_HOOK_OPTION_MIN || answer.options.length > SCRIPT_HOOK_OPTION_MAX) {
    throw new Error(`The Script Hooks answer needs ${SCRIPT_HOOK_OPTION_MIN} to ${SCRIPT_HOOK_OPTION_MAX} options.`);
  }
  const seenHooks = new Set<string>();
  const options = answer.options.map((raw, index) => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const hook = requireText(item.hook, `Hook option ${index + 1} needs a Hook.`, SCRIPT_HOOK_MAX);
    const key = uniqueHookKey(hook);
    if (seenHooks.has(key)) throw new Error(`Hook option ${index + 1} duplicates another Hook.`);
    seenHooks.add(key);
    return {
      id: `hook-${index + 1}`,
      hook,
      angle: requireText(item.angle, `Hook option ${index + 1} needs an Angle.`, SCRIPT_ANGLE_MAX),
      hypothesis: requireText(item.hypothesis, `Hook option ${index + 1} needs a hypothesis.`, SCRIPT_HYPOTHESIS_MAX),
      framework: requireFramework(item.framework, `Hook option ${index + 1}`),
      evidence: resolveScriptHookEvidence(item.evidence, evidence, index),
      edited: false,
    } satisfies ScriptHookOption;
  });

  const recommendation = answer.frameworkRecommendation;
  const recommendationObject = recommendation && typeof recommendation === "object" && !Array.isArray(recommendation)
    ? recommendation as Record<string, unknown>
    : {};
  return {
    hookOptions: parseScriptHookOptions(options),
    framework: requireFramework(recommendationObject.framework, "The framework recommendation"),
    frameworkReason: requireText(recommendationObject.reason, "The framework recommendation needs a reason.", SCRIPT_FIT_MAX),
  };
}

function requireFramework(value: unknown, prefix: string): ScriptFramework {
  if (value !== "pas" && value !== "bbb" && value !== "none") throw new Error(`${prefix} has an invalid framework.`);
  return value;
}

function scriptIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => line(item, 200)).filter(Boolean))];
}

export type ScriptInput = {
  ideaId: string;
  sourceSignalId?: string;
  evidenceSignalIds?: string[];
};

/** Creates the empty Hook-Selection document for an Idea. */
export function newScript(input: Partial<ScriptInput>, options: { id: string; now: string }): Script {
  const ideaId = line(input.ideaId, 200);
  if (!ideaId) throw new Error("A script needs an idea id.");
  const sourceSignalId = line(input.sourceSignalId, 200);
  return {
    id: options.id,
    ideaId,
    ...(sourceSignalId ? { sourceSignalId } : {}),
    evidenceSignalIds: scriptIds(input.evidenceSignalIds),
    status: "hook-selection",
    framework: "none",
    frameworkReason: "",
    hookOptions: [],
    sections: [],
    revision: 0,
    createdAt: options.now,
    updatedAt: options.now,
  };
}

/** Convenience constructor used by the Develop flow. */
export function newScriptFromIdea(
  idea: Pick<Idea, "id" | "sourceSignalId">,
  options: { id: string; now: string; evidenceSignalIds?: string[] },
) {
  return newScript(
    { ideaId: idea.id, sourceSignalId: idea.sourceSignalId, evidenceSignalIds: options.evidenceSignalIds },
    { id: options.id, now: options.now },
  );
}

/** Moves a Script by hand. Hook-Selection to Draft is reserved for a successful Draft run. */
export function moveScript(script: Script, to: ScriptStatus, now: string): Script {
  if (script.runId) throw new ForbiddenMoveError("A script cannot change status while a run is in progress.");
  requireTransition(script.status, to);
  const moved: Script = { ...script, status: to, updatedAt: now };
  if (script.status === "approved" && to === "draft") {
    moved.revision = script.revision + 1;
  }
  if (to === "approved") {
    moved.approvedRevision = script.revision;
    moved.approvedAt = now;
  }
  return moved;
}

/**
 * Applies one human editor PATCH. Section content is validated as a complete
 * list before it can be stored, and a changed list advances the revision once.
 * Reopening an approved Script is deliberately a status-only operation.
 */
export function patchScript(script: Script, patch: ScriptPatch, now: string): Script {
  const hasSections = patch.sections !== undefined;
  const hasFramework = patch.framework !== undefined;
  const hasStatus = patch.status !== undefined;
  const hasEvidence = patch.evidenceSignalIds !== undefined;
  const hasHookOptions = patch.hookOptions !== undefined;
  const hasSelectedHook = patch.selectedHookId !== undefined;

  if (script.status === "approved" && (hasSections || hasFramework || hasEvidence || hasHookOptions || hasSelectedHook || patch.status !== "draft")) {
    throw new ForbiddenMoveError("An approved script is immutable until it is reopened.");
  }
  if (script.runId && (hasSections || hasFramework || hasStatus || hasEvidence || hasHookOptions || hasSelectedHook)) {
    throw new ForbiddenMoveError("A script cannot be edited while a run is in progress.");
  }

  let next: Script = script;
  if (hasSections) {
    const sections = parseScriptSections(patch.sections);
    if (!same(sections, script.sections)) {
      next = { ...next, sections, revision: next.revision + 1, updatedAt: now };
    }
  }
  if (hasFramework && patch.framework !== next.framework) {
    next = { ...next, framework: patch.framework as ScriptFramework, updatedAt: now };
  }
  if (hasEvidence) {
    const evidenceSignalIds = scriptIds(patch.evidenceSignalIds).filter((id) => id !== next.sourceSignalId).slice(0, SCRIPT_EVIDENCE_LIMIT);
    if (!same(evidenceSignalIds, next.evidenceSignalIds)) next = { ...next, evidenceSignalIds, updatedAt: now };
  }
  if (hasHookOptions) {
    const hookOptions = parseScriptHookOptions(patch.hookOptions);
    if (!same(hookOptions, next.hookOptions)) next = { ...next, hookOptions, updatedAt: now };
  }
  if (hasSelectedHook) {
    const selectedHookId = patch.selectedHookId;
    if (selectedHookId === null) {
      if (next.selectedHookId !== undefined) {
        const { selectedHookId: _selectedHookId, ...withoutSelection } = next;
        next = { ...withoutSelection, updatedAt: now };
      }
    } else if (selectedHookId !== undefined) {
      next = selectHookOption(next, selectedHookId, now);
    }
  }
  if (hasStatus) next = moveScript(next, patch.status as ScriptStatus, now);
  return next;
}

/** Keeps the approved lock intact even when a caller writes a whole Script row. */
export function validateScriptWrite(previous: Script | null, next: Script): void {
  if (!previous || previous.status !== "approved" || same(previous, next)) return;
  const reopened = moveScript(previous, "draft", next.updatedAt);
  if (!same(reopened, next)) {
    throw new ForbiddenMoveError("An approved script is immutable until it is reopened.");
  }
}

/** Claims one Bridge run. Callers may reject a second active run instead of superseding it. */
export function claimScriptRun(script: Script, runId: string, now: string, options: ScriptRunClaimOptions = {}): Script {
  if (!line(runId, 200)) throw new Error("A script run needs an id.");
  if (script.status === "approved" && !options.allowApproved) {
    throw new ForbiddenMoveError("An approved script is immutable until it is reopened.");
  }
  if (options.rejectIfRunning && script.runId) throw new ScriptRunConflictError();
  return { ...script, runId, updatedAt: now };
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Settles the current run, or returns null when a newer run owns the claim. */
export function settleScriptRun(script: Script, runId: string, result: SettleScriptRun): Script | null {
  if (script.runId !== runId) return null;
  if (script.status === "approved" && Object.keys(result).some((key) => key !== "now")) {
    throw new ForbiddenMoveError("An approved script is immutable until it is reopened.");
  }

  const { runId: _runId, ...withoutRun } = script;
  const settled: Script = { ...withoutRun, updatedAt: result.now };
  if (result.status !== undefined) {
    const draftRun = result.status === "draft" && (script.status === "hook-selection" || script.status === "draft");
    if (!draftRun && result.status !== script.status) requireTransition(script.status, result.status);
    settled.status = result.status;
  }
  if (result.framework !== undefined) settled.framework = result.framework;
  if (result.frameworkReason !== undefined) settled.frameworkReason = line(result.frameworkReason, SCRIPT_FIT_MAX);
  if (result.hookOptions !== undefined) settled.hookOptions = parseScriptHookOptions(result.hookOptions);
  if (result.selectedHookId !== undefined) {
    if (result.selectedHookId === null) delete settled.selectedHookId;
    else settled.selectedHookId = line(result.selectedHookId, 200);
  }
  if (result.sections !== undefined) {
    const sections = parseScriptSections(result.sections);
    settled.sections = sections;
    settled.revision = script.revision + 1;
  }
  if (settled.status === "approved") {
    settled.approvedRevision = settled.revision;
    settled.approvedAt = result.now;
  }
  return settled;
}

/** Chooses an existing Hook-Option without changing its wording. */
export function selectHookOption(script: Script, hookId: string, now: string): Script {
  if (script.status === "approved") throw new ForbiddenMoveError("An approved script is immutable until it is reopened.");
  const id = line(hookId, 200);
  if (!script.hookOptions.some((option) => option.id === id)) throw new Error(`Unknown hook option ${id}.`);
  return { ...script, selectedHookId: id, updatedAt: now };
}

/** Edits only the Hook and Angle of an option and records that Chris changed it. */
export function editHookOption(script: Script, hookId: string, values: { hook: string; angle: string }, now: string): Script {
  if (script.status === "approved") throw new ForbiddenMoveError("An approved script is immutable until it is reopened.");
  const id = line(hookId, 200);
  let found = false;
  const hook = requireText(values.hook, "A hook is required.", SCRIPT_HOOK_MAX);
  const angle = requireText(values.angle, "An angle is required.", SCRIPT_ANGLE_MAX);
  const hookOptions = script.hookOptions.map((option) => {
    if (option.id !== id) return option;
    found = true;
    return { ...option, hook, angle, edited: true };
  });
  if (!found) throw new Error(`Unknown hook option ${id}.`);
  return { ...script, hookOptions, selectedHookId: id, updatedAt: now };
}

/** Adds a human-written option and selects it as the current direction. */
export function addCustomHookOption(
  script: Script,
  values: { hook: string; angle: string; framework?: ScriptFramework },
  now: string,
): Script {
  if (script.status === "approved") throw new ForbiddenMoveError("An approved script is immutable until it is reopened.");
  if (script.hookOptions.length >= SCRIPT_HOOK_OPTION_MAX) throw new Error(`A Script can hold at most ${SCRIPT_HOOK_OPTION_MAX} Hook options.`);
  const hook = requireText(values.hook, "A hook is required.", SCRIPT_HOOK_MAX);
  const angle = requireText(values.angle, "An angle is required.", SCRIPT_ANGLE_MAX);
  const framework = values.framework ?? script.framework;
  if (!SCRIPT_FRAMEWORKS.includes(framework)) throw new Error("The custom Hook has an invalid framework.");
  const option: ScriptHookOption = {
    id: `custom-${script.hookOptions.length + 1}`,
    hook,
    angle,
    hypothesis: "Eigener Hook",
    framework,
    evidence: [],
    edited: true,
  };
  return { ...script, hookOptions: [...script.hookOptions, option], selectedHookId: option.id, updatedAt: now };
}

/** Counts every status, including zeroes, so the Scripts bar does not shift. */
export function countByStatus(scripts: readonly Script[]): Record<ScriptStatus, number> {
  const counts = Object.fromEntries(SCRIPT_STATUSES.map((status) => [status, 0])) as Record<ScriptStatus, number>;
  for (const script of scripts) if (script.status in counts) counts[script.status] += 1;
  return counts;
}

export type ScriptMove = { id: string; status: ScriptStatus };

/** Parses the body of a manual Script status move. */
export function parseScriptMove(body: unknown): ScriptMove {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const id = line(input.id, 200);
  if (!id) throw new Error("id required");
  if (typeof input.status !== "string" || !SCRIPT_STATUSES.includes(input.status as ScriptStatus)) {
    throw new Error(`status must be one of ${SCRIPT_STATUSES.join(", ")}`);
  }
  return { id, status: input.status as ScriptStatus };
}
