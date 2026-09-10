import type { Forecast, Idea, IdeaStage, IdeaStatus, Storyboard, StoryboardBeat } from "./contracts";

export const IDEA_TITLE_MAX = 200;
export const IDEA_GOAL_MAX = 800;
/** Bounds for one storyboard field. The Bridge is the untrusted side of this contract. */
export const STORYBOARD_LINE_MAX = 400;
export const STORYBOARD_BEATS = 3;

/** The production stages in pipeline order; the counter bar and the moves read this. */
export const IDEA_STAGES: readonly IdeaStage[] = ["captured", "developing", "packaging", "scripting", "producing", "published"];
/** Every status the counter bar and the move parser know: the stages plus dropped. */
export const IDEA_STATUSES: readonly IdeaStatus[] = [...IDEA_STAGES, "dropped"];

/** The stage after this one, or null at the end of the pipeline and on dropped. */
export function nextStage(status: IdeaStatus): IdeaStage | null {
  const position = IDEA_STAGES.indexOf(status as IdeaStage);
  return position >= 0 ? (IDEA_STAGES[position + 1] ?? null) : null;
}

/**
 * Allowed moves, the only place they are defined. An Idea walks the stages one
 * at a time and never back, any stage before published can be dropped, and
 * published and dropped are final. developing -> developing is a second develop
 * run replacing the storyboard; a later stage is not developed again.
 */
export function canTransition(from: IdeaStatus, to: IdeaStatus) {
  if (from === "dropped" || from === "published") return false;
  if (to === "dropped") return true;
  if (from === "developing" && to === "developing") return true;
  return nextStage(from) === to;
}

/**
 * A move the rules do not allow. Its own class so the route can answer 409 for
 * exactly this and not for a store that is unreachable.
 */
export class ForbiddenMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenMoveError";
  }
}

/** A second Develop click cannot claim the same Idea while its current run is active. */
export class DevelopConflictError extends Error {
  constructor(message = "This Idea is already being developed.") {
    super(message);
    this.name = "DevelopConflictError";
  }
}

/** Refuses by name, so the caller can show why a move was not allowed. */
function requireTransition(from: IdeaStatus, to: IdeaStatus) {
  if (!canTransition(from, to)) throw new ForbiddenMoveError(`An idea cannot move from ${from} to ${to}.`);
}

/** Moves an Idea by hand. A forbidden move throws instead of being ignored. */
export function moveIdea(idea: Idea, to: IdeaStatus, now: string): Idea {
  requireTransition(idea.status, to);
  return { ...idea, status: to, updatedAt: now };
}

/** How many Ideas sit on each stage, every stage listed even when empty; a status the pipeline does not know is not counted. */
export function countByStage(ideas: readonly Idea[]): Record<IdeaStatus, number> {
  const counts = Object.fromEntries(IDEA_STATUSES.map((status) => [status, 0])) as Record<IdeaStatus, number>;
  for (const idea of ideas) if (idea.status in counts) counts[idea.status] += 1;
  return counts;
}

/**
 * Maps a stored status onto the current stages. The four statuses before the
 * pipeline (captured, developed, produced, dropped) land on the matching stage;
 * a current status passes through; anything else is null.
 */
export function legacyStage(status: string): IdeaStatus | null {
  if (status === "developed") return "developing";
  if (status === "produced") return "producing";
  return IDEA_STATUSES.includes(status as IdeaStatus) ? (status as IdeaStatus) : null;
}

/** One PATCH body for `/api/ideas`: the id plus the stage to move to. */
export type IdeaMove = { id: string; status: IdeaStatus };

/** Bounds and rejects the body of `PATCH /api/ideas`; the route only maps the throw to a 400. */
export function parseIdeaMove(body: unknown): IdeaMove {
  const input = (body ?? {}) as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) throw new Error("id required");
  const status = input.status;
  if (typeof status !== "string" || !IDEA_STATUSES.includes(status as IdeaStatus)) {
    throw new Error(`status must be one of ${IDEA_STATUSES.join(", ")}`);
  }
  return { id, status: status as IdeaStatus };
}

/** One bounded line: whitespace collapsed, trimmed, cut. Shared with lib/hooks-board.ts. */
export function bounded(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
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
 * Claims the Idea for one develop run. Storage adapters add the atomic conflict
 * guard; this pure helper only applies the claim once the adapter has accepted it.
 */
export function claimDevelop(idea: Idea, runId: string, now: string): Idea {
  requireTransition(idea.status, "developing");
  return { ...idea, developRunId: runId, updatedAt: now };
}

/**
 * Writes the storyboard, or null when a newer run has taken the claim. The
 * forecast of the previous run goes with it: a run without one leaves none.
 */
export function applyStoryboard(
  idea: Idea,
  runId: string,
  storyboard: Storyboard,
  options: { now: string; evidenceCount: number; forecast: Forecast | null },
): Idea | null {
  if (idea.developRunId !== runId) return null;
  // The previous forecast belongs to the previous storyboard and goes with it.
  const { developRunId, forecast: _previous, ...rest } = idea;
  return {
    ...rest,
    status: "developing",
    storyboard,
    ...(options.forecast ? { forecast: options.forecast } : {}),
    developedAt: options.now,
    evidenceCount: options.evidenceCount,
    updatedAt: options.now,
  };
}

/** Adds a Script-derived Storyboard without replacing concurrent stage or cover writes. */
export function attachStoryboard(
  idea: Idea,
  storyboard: Storyboard,
  options: { now: string; evidenceCount: number; forecast: Forecast | null },
): Idea {
  const { forecast: _previous, ...rest } = idea;
  return {
    ...rest,
    storyboard,
    ...(options.forecast ? { forecast: options.forecast } : {}),
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
