import type { Idea, IdeaStatus, Storyboard, StoryboardBeat } from "./contracts";

export const IDEA_TITLE_MAX = 200;
export const IDEA_GOAL_MAX = 800;
/** Bounds for one storyboard field. The Bridge is the untrusted side of this contract. */
export const STORYBOARD_LINE_MAX = 400;
export const STORYBOARD_BEATS = 3;

/**
 * Allowed moves. An Idea never returns to captured, a produced Idea is not
 * re-developed, and dropped is final. developed -> developed is a second
 * develop run replacing the storyboard.
 */
const TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
  captured: ["developed", "dropped"],
  developed: ["developed", "produced", "dropped"],
  produced: ["dropped"],
  dropped: [],
};

export function canTransition(from: IdeaStatus, to: IdeaStatus) {
  return TRANSITIONS[from].includes(to);
}

/** Refuses by name, so the caller can show why a move was not allowed. */
function requireTransition(from: IdeaStatus, to: IdeaStatus) {
  if (!canTransition(from, to)) throw new Error(`An idea cannot move from ${from} to ${to}.`);
}

function bounded(value: string | undefined, max: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Everything one capture carries. The form fills the first two, a card fills all five. */
export type IdeaInput = {
  title: string;
  goal?: string;
  sourceSignalId?: string;
  sourceCreator?: string;
  sourceUrl?: string;
};

/** Only https links to the source Reel are kept; anything else is dropped. */
function sourceLink(value: string | undefined) {
  const raw = bounded(value, 500);
  if (!raw) return "";
  try {
    return new URL(raw).protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
}

/** One captured Idea. The caller owns id and clock so this stays pure. */
export function newIdea(input: Partial<IdeaInput>, options: { id: string; now: string }): Idea {
  const title = bounded(input.title, IDEA_TITLE_MAX);
  if (!title) throw new Error("An idea title is required.");
  const goal = bounded(input.goal, IDEA_GOAL_MAX);
  const sourceSignalId = bounded(input.sourceSignalId, 200);
  const sourceCreator = bounded(input.sourceCreator, 120);
  const sourceUrl = sourceLink(input.sourceUrl);

  return {
    id: options.id,
    title,
    ...(goal ? { goal } : {}),
    status: "captured",
    ...(sourceSignalId ? { sourceSignalId } : {}),
    ...(sourceCreator ? { sourceCreator } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    createdAt: options.now,
    updatedAt: options.now,
  };
}

/**
 * Claims the Idea for one develop run. The claim is the whole collision guard:
 * a second run overwrites it, and the first run's result is then stale.
 */
export function claimDevelop(idea: Idea, runId: string, now: string): Idea {
  requireTransition(idea.status, "developed");
  return { ...idea, developRunId: runId, updatedAt: now };
}

/** Writes the storyboard, or null when a newer run has taken the claim. */
export function applyStoryboard(
  idea: Idea,
  runId: string,
  storyboard: Storyboard,
  options: { now: string; evidenceCount: number },
): Idea | null {
  if (idea.developRunId !== runId) return null;
  const { developRunId, ...rest } = idea;
  return {
    ...rest,
    status: "developed",
    storyboard,
    developedAt: options.now,
    evidenceCount: options.evidenceCount,
    updatedAt: options.now,
  };
}

/** Gives the claim back after a failed run, or null when it is no longer this run's. */
export function releaseDevelop(idea: Idea, runId: string, now: string): Idea | null {
  if (idea.developRunId !== runId) return null;
  const { developRunId, ...rest } = idea;
  return { ...rest, updatedAt: now };
}

/**
 * Like bounded, but keeps line breaks. A caption is posted as written, and its
 * first line has to stay a Hook of its own.
 */
export function boundedText(value: string | undefined, max: number) {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((part) => part.trim())
    .join("\n")
    .trim()
    .slice(0, max);
}

function line(source: Record<string, unknown>, field: string, keepBreaks = false) {
  const raw = typeof source[field] === "string" ? (source[field] as string) : "";
  const value = keepBreaks ? boundedText(raw, STORYBOARD_LINE_MAX) : bounded(raw, STORYBOARD_LINE_MAX);
  if (!value) throw new Error(`Storyboard field ${field} is empty.`);
  return value;
}

/** Validates what the Bridge returned before it is stored on an Idea. */
export function parseStoryboard(value: unknown): Storyboard {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Storyboard must be an object.");
  }
  const source = value as Record<string, unknown>;
  const rawBeats = source.beats;
  if (!Array.isArray(rawBeats) || rawBeats.length !== STORYBOARD_BEATS) {
    throw new Error(`A storyboard needs exactly three beats.`);
  }

  const beats: StoryboardBeat[] = rawBeats.map((raw, index) => {
    const beat = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = bounded(typeof beat.label === "string" ? beat.label : "", STORYBOARD_LINE_MAX);
    const detail = bounded(typeof beat.detail === "string" ? beat.detail : "", STORYBOARD_LINE_MAX);
    if (!label || !detail) throw new Error(`Storyboard beat ${index + 1} needs a label and a detail.`);
    return { label, detail };
  });

  return {
    hook: line(source, "hook"),
    beats,
    cta: line(source, "cta"),
    caption: line(source, "caption", true),
    takeaway: line(source, "takeaway"),
  };
}
