import type { RankedSignal, SignalRecord } from "./contracts";
import { OUTLIER_THRESHOLDS, type OutlierThreshold } from "./discover-filter.ts";

/** What the detail page reads off one signal. The corpus holds reels and posts, so this is not reel-only. */
export type CreatorSignal = Pick<SignalRecord, "publishedAt" | "views"> &
  Partial<Pick<SignalRecord, "plays">> &
  Partial<Pick<RankedSignal, "outlier">>;

/** The four numbers of the stat bar, read off the retained corpus of one creator. */
export type CreatorStats = {
  /** Reach over the whole corpus: plays, or views for a record the connector left without plays. */
  views: number;
  /** Signals kept for this creator. */
  retained: number;
  /** null for an empty corpus: no upload, no average. */
  averageOutlier: number | null;
  strongestOutlier: number | null;
};

/** The columns the table sorts by, in the order the header renders them. */
export const CREATOR_SORTS = ["published", "plays", "outlier"] as const;
export type CreatorSort = (typeof CREATOR_SORTS)[number];
export type SortDirection = "asc" | "desc";
/** Sort column plus direction. They are only ever read together. */
export type CreatorSortState = { sort: CreatorSort; direction: SortDirection };

/** Instagram delivers plays; a record without them is read at its view count. */
export function signalReach(signal: CreatorSignal) {
  return signal.plays ?? signal.views;
}

const published = (signal: CreatorSignal) => new Date(signal.publishedAt).getTime();

/** Every retained signal of one creator, newest first. */
export function creatorSignals<T extends { creatorId: string } & CreatorSignal>(signals: T[], creatorId: string): T[] {
  return sortCreatorSignals(signals.filter((signal) => signal.creatorId === creatorId), { sort: "published", direction: "desc" });
}

/**
 * The stat bar. An empty corpus reports null averages rather than a confident 0.00x,
 * and a signal the scorer left without an outlier counts as zero instead of dropping
 * out of the average.
 */
export function creatorStats(signals: CreatorSignal[]): CreatorStats {
  const outliers = signals.map((signal) => signal.outlier ?? 0);
  return {
    views: signals.reduce((sum, signal) => sum + signalReach(signal), 0),
    retained: signals.length,
    averageOutlier: signals.length ? outliers.reduce((sum, value) => sum + value, 0) / signals.length : null,
    strongestOutlier: signals.length ? Math.max(...outliers) : null,
  };
}

const metric: Record<CreatorSort, (signal: CreatorSignal) => number> = {
  published,
  plays: signalReach,
  outlier: (signal) => signal.outlier ?? 0,
};

/** Sorts a copy. Equal values fall back to the newest upload, so the order never wobbles. */
export function sortCreatorSignals<T extends CreatorSignal>(signals: T[], { sort, direction }: CreatorSortState): T[] {
  const read = metric[sort];
  const sign = direction === "asc" ? 1 : -1;
  return [...signals].sort((a, b) => sign * (read(a) - read(b)) || published(b) - published(a));
}

/** The tab the desk opens on. Written into the back link, read by the shell on mount. */
export const TAB_PARAM = "tab";
/** Which desk tab a creator was opened from, so the back link returns to it. */
export const FROM_PARAM = "from";
/** Outlier threshold carried along, so the detail page limes at what the desk limed at. */
export const THRESHOLD_PARAM = "threshold";

/** The desk, on one tab. */
export function tabPath(tab: string) {
  return `/?${TAB_PARAM}=${encodeURIComponent(tab)}`;
}

/**
 * The detail route of one creator. The id is escaped, so it cannot walk out of the
 * segment; origin tab and threshold ride along so the page can go back where it came
 * from and highlight at the same threshold.
 */
export function creatorPath(id: string, origin?: { from: string; threshold?: number }) {
  const query = new URLSearchParams();
  if (origin) {
    query.set(FROM_PARAM, origin.from);
    if (origin.threshold !== undefined) query.set(THRESHOLD_PARAM, String(origin.threshold));
  }
  const search = query.toString();
  return `/creator/${encodeURIComponent(id)}${search ? `?${search}` : ""}`;
}

/** Reads the threshold off a query string, falling back to the default for anything unselectable. */
export function parseThreshold(search: string, fallback: OutlierThreshold): OutlierThreshold {
  const raw = Number(new URLSearchParams(search).get(THRESHOLD_PARAM));
  return OUTLIER_THRESHOLDS.find((value) => value === raw) ?? fallback;
}
