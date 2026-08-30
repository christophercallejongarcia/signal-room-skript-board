import { BRIEFING_WINDOW_HOURS, SLATE_DIRECTION_MAX, SLATE_PITCH_MAX, SLATE_SIZE, SLATE_SOURCE_LIMIT, SLATE_TOPIC_MAX } from "./config.ts";
import { selectBriefingSignals, type BriefingOptions } from "./briefing.ts";
import type { BriefingItem, Creator, Idea, RankedSignal, SignalRecord, Slate, SlateStart } from "./contracts";
import { bounded, newIdea } from "./ideas.ts";

const HOUR = 3_600_000;

/**
 * What the bridge keeps of a packet entry before it drops entries without a
 * title or handle (MAX_TITLE and MAX_CREATOR in bridge/request.mjs). A start
 * names its Reel by position into the packet the bridge accepted, so the app
 * has to drop the same entries before it sends them, or the positions shift.
 */
const PACKET_TITLE_MAX = 300;
const PACKET_CREATOR_MAX = 120;

/**
 * A request the slate refuses by its own rules: a position it does not carry,
 * a start already turned into an Idea, a window with nothing left in it. Its
 * own class so a route can answer 409 for exactly this and 500 for a store or
 * a bridge that failed.
 */
export class SlateRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlateRefusal";
  }
}

/** One document per day, so the refresh that runs second finds the first one's slate. */
export function slateId(now: number) {
  return `slate-${new Date(now).toISOString().slice(0, 10)}`;
}

/** The fields of a source Reel a start keeps, plus the caption the packet carries. A BriefingItem has them all. */
export type SlateSource = Pick<BriefingItem, "signalId" | "creator" | "title" | "caption" | "plays" | "outlier" | "url">;

/**
 * The Reels a slate is read from: the ranked short-form Reels of the window,
 * the same selection the Briefing makes, cut at SLATE_SOURCE_LIMIT. A Reel
 * without a title or handle cannot be cited back and is left out here, so the
 * packet the Bridge accepts is the packet the answer's positions point into.
 */
export function slateSources(
  signals: SignalRecord[] | RankedSignal[],
  creators: Creator[],
  options: BriefingOptions = {},
): SlateSource[] {
  return selectBriefingSignals(signals, creators, { ...options, limit: SLATE_SOURCE_LIMIT }).filter(
    (item) => bounded(item.title, PACKET_TITLE_MAX) && bounded(item.creator, PACKET_CREATOR_MAX),
  );
}

/** Reads one position the Bridge named. Only an integer inside the packet counts. */
function sourceAt(value: unknown, sources: SlateSource[], position: number): SlateSource {
  const index = typeof value === "number" && Number.isInteger(value) ? value : 0;
  const source = index >= 1 ? sources[index - 1] : undefined;
  if (!source) throw new Error(`Start ${position} names no source in the packet.`);
  return source;
}

/**
 * One start as the Bridge returned it, bound and tied to the packet Reel it
 * names. The source is a 1-based position into the packet, never a title, so a
 * Reel is never matched back by text and two Reels with one title stay apart.
 */
export function parseSlateStart(value: unknown, sources: SlateSource[], position: number): SlateStart {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const pitch = bounded(raw.pitch, SLATE_PITCH_MAX);
  if (!pitch) throw new Error(`Start ${position} has no pitch.`);
  const topic = bounded(raw.topic, SLATE_TOPIC_MAX);
  if (!topic) throw new Error(`Start ${position} has no topic.`);
  const source = sourceAt(raw.source, sources, position);

  return {
    position,
    pitch,
    topic,
    sourceSignalId: source.signalId,
    sourceCreator: source.creator,
    sourceTitle: source.title,
    ...(source.url ? { sourceUrl: source.url } : {}),
    outlier: source.outlier,
    plays: source.plays,
  };
}

/**
 * Validates a whole answer. It has to hold exactly the number of starts the run
 * asked for; a short list is refused whole, like a short list of angles, because
 * a slate that says ten and shows seven is a slate that lies.
 */
export function parseSlateAnswer(value: unknown, sources: SlateSource[], count: number): SlateStart[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The slate answer must be an object.");
  const raw = (value as { starts?: unknown }).starts;
  if (!Array.isArray(raw) || raw.length !== count) throw new Error(`The slate answer must hold exactly ${count} starts.`);
  return raw.map((entry, index) => parseSlateStart(entry, sources, index + 1));
}

export type NewSlateOptions = {
  id: string;
  /** Epoch ms of the run. */
  now: number;
  windowHours?: number;
  sources: number;
  starts: SlateStart[];
  /** The direction this run was given; it stays the direction for the next run. */
  direction?: string;
};

/** One freshly written slate. The caller owns id and clock so this stays pure. */
export function newSlate(options: NewSlateOptions): Slate {
  const windowHours = options.windowHours ?? BRIEFING_WINDOW_HOURS;
  const generatedAt = new Date(options.now).toISOString();
  const direction = bounded(options.direction, SLATE_DIRECTION_MAX);
  return {
    id: options.id,
    generatedAt,
    updatedAt: generatedAt,
    day: generatedAt.slice(0, 10),
    windowStart: new Date(options.now - windowHours * HOUR).toISOString(),
    windowHours,
    sources: options.sources,
    ...(direction ? { direction, directionApplied: direction } : {}),
    starts: options.starts,
  };
}

/** The index of the start at a position, or a refusal that names the position. */
export function requireStart(slate: Slate, position: number) {
  const index = slate.starts.findIndex((start) => start.position === position);
  if (index < 0) throw new SlateRefusal(`The slate has no start at position ${position}.`);
  return index;
}

/**
 * Puts one regenerated start in place of the one at its position. The other
 * starts are not touched, which is the whole point of regenerating one.
 */
export function replaceStart(slate: Slate, position: number, start: SlateStart, now: number): Slate {
  const index = requireStart(slate, position);
  const stamp = new Date(now).toISOString();
  const starts = slate.starts.slice();
  starts[index] = { ...start, position, regeneratedAt: stamp };
  // This run was given the slate's direction, or none: the status line says which.
  const { directionApplied: _previous, ...rest } = slate;
  return {
    ...rest,
    updatedAt: stamp,
    ...(slate.direction ? { directionApplied: slate.direction } : {}),
    starts,
  };
}

/** Stores the direction for the next run; an empty one clears it. */
export function withDirection(slate: Slate, direction: unknown, now: number): Slate {
  const { direction: _previous, ...rest } = slate;
  const next = bounded(direction, SLATE_DIRECTION_MAX);
  return { ...rest, ...(next ? { direction: next } : {}), updatedAt: new Date(now).toISOString() };
}

/** One PATCH body for `/api/slates`: the slate plus the direction to store on it. */
export type SlateDirection = { id: string; direction: string };

/** Bounds and rejects the body of `PATCH /api/slates`; the route only maps the throw to a 400. */
export function parseSlateDirection(body: unknown): SlateDirection {
  const input = (body ?? {}) as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) throw new Error("id required");
  if (input.direction !== undefined && typeof input.direction !== "string") throw new Error("direction must be a string");
  return { id, direction: bounded(input.direction, SLATE_DIRECTION_MAX) };
}

/** Reads the one flag `POST /api/slates` takes: rebuild the day's slate, or leave it as it is. */
export function parseSlateCompose(body: unknown): { force: boolean } {
  const input = (body ?? {}) as Record<string, unknown>;
  return { force: input.force === true };
}

/** One POST body for `/api/slates/regenerate` and `/api/slates/ideas`: the slate plus a position on it. */
export type SlatePosition = { id: string; position: number };

/** Bounds and rejects a body that names one start; the route only maps the throw to a 400. */
export function parseSlatePosition(body: unknown): SlatePosition {
  const input = (body ?? {}) as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) throw new Error("id required");
  const position = input.position;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 1 || position > SLATE_SIZE) {
    throw new Error(`position must be a whole number from 1 to ${SLATE_SIZE}`);
  }
  return { id, position };
}

/**
 * The click: one start becomes an Idea that carries its source Signal, and the
 * slate keeps the Idea's id at that position so the row can say so. A start is
 * turned once; a second click is refused instead of writing a twin.
 */
export function ideaFromStart(slate: Slate, position: number, options: { id: string; now: string }): { idea: Idea; slate: Slate } {
  const index = requireStart(slate, position);
  const start = slate.starts[index];
  if (start.ideaId) throw new SlateRefusal(`Start ${position} is already an idea.`);
  const idea = newIdea(
    {
      title: start.pitch,
      goal: `${start.topic}. Aus ${start.sourceCreator}: „${start.sourceTitle}“`,
      sourceSignalId: start.sourceSignalId,
      sourceCreator: start.sourceCreator,
      ...(start.sourceUrl ? { sourceUrl: start.sourceUrl } : {}),
    },
    options,
  );
  const starts = slate.starts.slice();
  starts[index] = { ...start, ideaId: idea.id };
  return { idea, slate: { ...slate, updatedAt: options.now, starts } };
}
