import {
  FORMAT_REVIEW_RISING_LIMIT,
  FORMAT_REVIEW_SMALL_AUDIENCE,
  FORMAT_WINDOW_DAYS,
  OUTLIER_THRESHOLD,
} from "./config.ts";
import { outlierScorer } from "./adapters/scoring/outlier.ts";
import type {
  Creator,
  FormatReview,
  FormatReviewPattern,
  PatternMove,
  PatternSnapshot,
  RankedSignal,
  RisingCreator,
  SignalRecord,
} from "./contracts";
import { isOutlier, isOwned } from "./discover-filter.ts";
import { UNCLASSIFIED, buildFormatSignals, classifyCaption, patternLabel } from "./format-signals.ts";

const DAY = 86_400_000;

/**
 * A share that moved less than one point of the corpus is noise, not a trend.
 * The move reads flat below it however far the raw count travelled.
 */
export const SHARE_EPSILON = 0.01;

const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** One review per run date, so a second pass on the same day overwrites the first. */
export function formatReviewId(now: number) {
  return `format-review-${new Date(now).toISOString().slice(0, 10)}`;
}

/**
 * The review a run diffs against: the newest stored one that is not the document
 * this run is about to write. Without it a rerun on the same day would diff the
 * review against itself and report a month in which nothing moved.
 */
export function previousReview(reviews: FormatReview[], now = Date.now()): FormatReview | null {
  const id = formatReviewId(now);
  return (
    [...reviews].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).find((review) => review.id !== id) ?? null
  );
}

export type FormatReviewOptions = {
  now?: number;
  windowDays?: number;
  threshold?: number;
  /** Follower count below which a creator counts as small. */
  smallAudience?: number;
  risingLimit?: number;
};

function snapshotOf(pattern: PatternSnapshot): PatternSnapshot {
  return {
    id: pattern.id,
    label: pattern.label,
    count: pattern.count,
    share: round3(pattern.share),
    averageOutlier: round1(pattern.averageOutlier),
  };
}

const EMPTY = { count: 0, share: 0, averageOutlier: 0 };

/** gone is decided first: a pattern at zero is gone even when last month already read zero. */
function moveOf(shareDelta: number, count: number, previousCount: number): PatternMove {
  if (count === 0) return "gone";
  if (previousCount === 0) return "new";
  if (Math.abs(shareDelta) < SHARE_EPSILON) return "flat";
  return shareDelta > 0 ? "up" : "down";
}

/**
 * The month over month diff over the union of both pattern lists. A pattern that
 * vanished stays in the list at zero, so the review reports what was lost rather
 * than silently dropping it. Pure: the caller decides where the snapshots come from.
 */
export function diffPatterns(current: PatternSnapshot[], previous: PatternSnapshot[] | null): FormatReviewPattern[] {
  const now = new Map(current.map((pattern) => [pattern.id, snapshotOf(pattern)]));
  const before = new Map((previous ?? []).map((pattern) => [pattern.id, snapshotOf(pattern)]));

  // A pattern that was already reported gone stays gone at zero on both sides. It is
  // reported once, in the review it disappeared in, and then leaves the list for good.
  const ids = [...new Set([...now.keys(), ...before.keys()])].filter(
    (id) => (now.get(id)?.count ?? 0) > 0 || (before.get(id)?.count ?? 0) > 0,
  );

  const patterns = ids.map((id): FormatReviewPattern => {
    const head = now.get(id);
    const tail = before.get(id);
    // A pattern only in last month's list keeps the label it was reviewed under.
    const base = head ?? { id, label: tail?.label ?? id, ...EMPTY };
    const previousSide = tail ?? EMPTY;
    const shareDelta = round3(base.share - previousSide.share);
    return {
      ...base,
      previousCount: previousSide.count,
      previousShare: previousSide.share,
      previousAverageOutlier: previousSide.averageOutlier,
      countDelta: base.count - previousSide.count,
      shareDelta,
      outlierDelta: round1(base.averageOutlier - previousSide.averageOutlier),
      move: moveOf(shareDelta, base.count, previousSide.count),
    };
  });

  // Unclassified is a residue, not a pattern: it reports its move from the bottom.
  patterns.sort((a, b) => {
    if (a.id === UNCLASSIFIED) return 1;
    if (b.id === UNCLASSIFIED) return -1;
    return b.shareDelta - a.shareDelta || b.countDelta - a.countDelta || a.label.localeCompare(b.label);
  });
  return patterns;
}

/**
 * Small accounts carrying a named pattern on an outlier reel: the shapes worth
 * copying before the large accounts get to them. One entry per creator, their
 * strongest reel. A pattern that is new this month outranks a stronger reel on
 * an established one, because the new shape is what the review is looking for.
 */
export function findRisingCreators(
  signals: RankedSignal[],
  creators: Creator[],
  patterns: { id: string; move: PatternMove }[],
  options: FormatReviewOptions = {},
): RisingCreator[] {
  const now = options.now ?? Date.now();
  const windowDays = options.windowDays ?? FORMAT_WINDOW_DAYS;
  const threshold = options.threshold ?? OUTLIER_THRESHOLD;
  const smallAudience = options.smallAudience ?? FORMAT_REVIEW_SMALL_AUDIENCE;
  const risingLimit = options.risingLimit ?? FORMAT_REVIEW_RISING_LIMIT;

  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
  const moves = new Map(patterns.map((pattern) => [pattern.id, pattern.move]));
  const best = new Map<string, RisingCreator>();

  for (const signal of signals) {
    if (signal.format !== "reel") continue;
    const creator = creatorMap.get(signal.creatorId);
    if (!creator) continue;
    // Chris' own account is never a rising creator of his own niche.
    if (isOwned(creator)) continue;
    if (creator.audience <= 0 || creator.audience >= smallAudience) continue;
    if (now - new Date(signal.publishedAt).getTime() > windowDays * DAY) continue;
    if (!isOutlier(signal, threshold)) continue;
    const patternId = classifyCaption(signal.caption ?? signal.title);
    if (patternId === UNCLASSIFIED) continue;
    const previous = best.get(creator.id);
    if (previous && previous.outlier >= signal.outlier) continue;
    best.set(creator.id, {
      creatorId: creator.id,
      name: creator.name,
      handle: creator.handle,
      audience: creator.audience,
      foreign: creator.foreign === true,
      patternId,
      patternLabel: patternLabel(patternId),
      patternMove: moves.get(patternId) ?? "new",
      signalId: signal.id,
      title: signal.title,
      outlier: signal.outlier,
      publishedAt: signal.publishedAt,
      ...(signal.url ? { url: signal.url } : {}),
    });
  }

  return [...best.values()]
    .sort((a, b) => rank(b) - rank(a) || b.outlier - a.outlier || a.handle.localeCompare(b.handle))
    .slice(0, risingLimit);
}

/** A new shape sorts above an established one, whatever the reach behind it. */
function rank(entry: RisingCreator) {
  return entry.patternMove === "new" ? 1 : 0;
}

/**
 * The monthly review: the niche's Format Signals over the window, diffed against
 * the review before it, plus the small creators worth watching. Pure over the
 * corpus and the previous document the caller hands in.
 */
export function buildFormatReview(
  signals: RankedSignal[],
  creators: Creator[],
  previous: FormatReview | null,
  options: FormatReviewOptions = {},
): FormatReview {
  const now = options.now ?? Date.now();
  const windowDays = options.windowDays ?? FORMAT_WINDOW_DAYS;
  const threshold = options.threshold ?? OUTLIER_THRESHOLD;
  const { own } = buildFormatSignals(signals, creators, { now, windowDays, threshold });
  const patterns = diffPatterns(own.signals, previous?.patterns ?? null);
  const settings = { ...options, now, windowDays, threshold };
  const periodEnd = new Date(now).toISOString();

  return {
    id: formatReviewId(now),
    generatedAt: periodEnd,
    periodStart: new Date(now - windowDays * DAY).toISOString(),
    periodEnd,
    windowDays,
    threshold,
    ...(previous ? { previousReviewId: previous.id, previousPeriodEnd: previous.periodEnd } : {}),
    total: own.total,
    previousTotal: previous?.total ?? 0,
    patterns,
    // Both niches: a small foreign account with a new shape is exactly what the
    // foreign group is kept for, and it carries its mark into the list.
    risingCreators: findRisingCreators(signals, creators, patterns, settings),
  };
}

/**
 * One review over a stored corpus: rank with the same scorer the tab uses, build
 * the Format Signals of the window, diff against the newest stored review that is
 * not this run's own document. The Convex cron and POST /api/format-reviews are
 * the two callers, so the monthly pass and the manual one cannot drift apart.
 */
export function reviewCorpus(
  corpus: { creators: Creator[]; signals: SignalRecord[]; reviews: FormatReview[] },
  now: number,
): FormatReview {
  const ranked = outlierScorer.rank(corpus.signals, corpus.creators, new Date(now));
  return buildFormatReview(ranked, corpus.creators, previousReview(corpus.reviews, now), { now });
}
