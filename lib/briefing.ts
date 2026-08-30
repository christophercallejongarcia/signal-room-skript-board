import {
  BRIEFING_ANGLE_MAX,
  BRIEFING_CAPTION_EXCERPT,
  BRIEFING_LIMIT,
  BRIEFING_WINDOW_HOURS,
} from "./config.ts";
import { outlierScorer } from "./adapters/scoring/outlier.ts";
import type { Briefing, BriefingItem, Creator, RankedSignal, SignalRecord, StrategyEvidenceItem } from "./contracts";
import { withoutOwned } from "./discover-filter.ts";
import { bounded } from "./ideas.ts";
import { captionExcerpt } from "./strategy-evidence.ts";

const HOUR = 3_600_000;

/**
 * How far freshness can pull a reel down inside the window. A reel at the window
 * edge keeps half its outlier, a reel just published keeps all of it. The floor is
 * what stops freshness from deciding the list on its own: at 0.5 a reel needs
 * twice the outlier of a brand new one to win from the edge of the window.
 */
export const BRIEFING_FRESHNESS_FLOOR = 0.5;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** 1 at publication, the floor at the window edge and beyond. Linear in between. */
export function briefingFreshness(ageHours: number, windowHours = BRIEFING_WINDOW_HOURS) {
  if (windowHours <= 0) return 1;
  const travelled = Math.min(1, Math.max(0, ageHours / windowHours));
  return 1 - (1 - BRIEFING_FRESHNESS_FLOOR) * travelled;
}

/**
 * What the briefing ranks by: Outlier times Frische. The outlier is the reach that
 * earned attention, freshness is what makes it today's news rather than last week's.
 */
export function briefingScore(outlier: number, ageHours: number, windowHours = BRIEFING_WINDOW_HOURS) {
  return round2(outlier * briefingFreshness(ageHours, windowHours));
}

export type BriefingOptions = {
  /** Epoch ms the window is measured from. */
  now?: number;
  windowHours?: number;
  limit?: number;
};

/** One document per day, so a second refresh on the same day overwrites the first. */
export function briefingId(now: number) {
  return `briefing-${new Date(now).toISOString().slice(0, 10)}`;
}

/**
 * Image posts and long form never carry a briefing; a Signal that declares no
 * format at all stays in, which is how the synthetic demo corpus still renders.
 */
function isShortForm(signal: Pick<SignalRecord, "format">) {
  return signal.format !== "post" && signal.format !== "long";
}

/**
 * The ranked reels of the window, strongest first: the niche only, short form only,
 * published inside the window. Pure over the corpus the caller hands in.
 */
export function selectBriefingSignals(
  signals: SignalRecord[] | RankedSignal[],
  creators: Creator[],
  options: BriefingOptions = {},
): BriefingItem[] {
  const now = options.now ?? Date.now();
  const windowHours = options.windowHours ?? BRIEFING_WINDOW_HOURS;
  const limit = options.limit ?? BRIEFING_LIMIT;
  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
  // Chris' own uploads are research about him, not about the niche. Profile reads them.
  const ranked = outlierScorer.rank(withoutOwned(signals as SignalRecord[], creators), creators, new Date(now));

  return ranked
    .filter(isShortForm)
    .map((signal) => {
      const creator = creatorMap.get(signal.creatorId)!;
      const ageHours = Math.max(0, (now - new Date(signal.publishedAt).getTime()) / HOUR);
      return { signal, creator, ageHours };
    })
    .filter(({ ageHours }) => ageHours <= windowHours)
    .map(({ signal, creator, ageHours }): BriefingItem => ({
      signalId: signal.id,
      creatorId: creator.id,
      creatorName: creator.name,
      creator: creator.handle,
      title: signal.title,
      publishedAt: signal.publishedAt,
      plays: signal.plays ?? signal.views,
      outlier: signal.outlier,
      velocity: signal.velocity,
      score: briefingScore(signal.outlier, ageHours, windowHours),
      caption: captionExcerpt(signal.caption, BRIEFING_CAPTION_EXCERPT),
      thumbnailSeed: signal.thumbnailSeed,
      topic: signal.topic,
      ...(signal.url ? { url: signal.url } : {}),
      ...(signal.coverUrl ? { coverUrl: signal.coverUrl } : {}),
    }))
    .sort((a, b) => b.score - a.score || b.outlier - a.outlier || b.plays - a.plays)
    .slice(0, limit);
}

/**
 * One daily Briefing over the corpus, without angles. The angles are hung on it
 * afterwards by applyAngles, so a Bridge that is down still leaves a briefing.
 */
export function buildBriefing(
  signals: SignalRecord[] | RankedSignal[],
  creators: Creator[],
  options: BriefingOptions = {},
): Briefing {
  const now = options.now ?? Date.now();
  const windowHours = options.windowHours ?? BRIEFING_WINDOW_HOURS;
  // Everything the window held, so the tab can say what the top cut left out.
  const candidates = selectBriefingSignals(signals, creators, { ...options, now, limit: Number.MAX_SAFE_INTEGER });
  const items = candidates.slice(0, options.limit ?? BRIEFING_LIMIT);

  return {
    id: briefingId(now),
    generatedAt: new Date(now).toISOString(),
    day: new Date(now).toISOString().slice(0, 10),
    windowStart: new Date(now - windowHours * HOUR).toISOString(),
    windowHours,
    sources: new Set(items.map((item) => item.creatorId)).size,
    candidates: candidates.length,
    angles: false,
    items,
  };
}

/**
 * The ranked reels as the Bridge reads them. A briefing item already carries the
 * excerpt and the numbers, so the packet is a projection, not a second selection.
 * The Briefing and the Slate hand the Bridge the same shape.
 */
export function briefingPacket(items: Pick<BriefingItem, "title" | "creator" | "caption" | "plays" | "outlier">[]): StrategyEvidenceItem[] {
  return items.map((item) => ({
    title: item.title,
    creator: item.creator,
    caption: item.caption,
    plays: item.plays,
    outlier: item.outlier,
  }));
}

/**
 * Hangs the Bridge's answer on the items. The answer is a list of angles in the
 * order of the items it was written for, so nothing has to be matched back by
 * text — but that order is the whole contract, and the Bridge is the untrusted
 * side of it. An answer that does not hold exactly one entry per item is refused
 * whole: a short list would push every later angle onto the wrong reel, and a
 * briefing with the wrong angles is worse than one with none. The briefing is the
 * document, the angle is the garnish, so a refusal costs only the garnish.
 */
export function applyAngles(briefing: Briefing, value: unknown): Briefing {
  const raw = value && typeof value === "object" ? (value as { angles?: unknown }).angles : undefined;
  if (!Array.isArray(raw) || raw.length !== briefing.items.length) return { ...briefing, angles: false };

  const angles = raw.map((angle) => bounded(angle, BRIEFING_ANGLE_MAX));
  const items = briefing.items.map((item, index) => (angles[index] ? { ...item, angle: angles[index] } : item));
  return { ...briefing, items, angles: items.some((item) => item.angle) };
}
