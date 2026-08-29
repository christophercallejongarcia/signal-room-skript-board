import type { Creator, Network, RankedSignal, SignalRecord } from "./contracts";

/** Selectable outlier thresholds (plays divided by followers). */
export const OUTLIER_THRESHOLDS = [1.5, 2, 3, 5] as const;
export type OutlierThreshold = (typeof OUTLIER_THRESHOLDS)[number];
/** Default threshold. Re-exported by lib/config.ts as OUTLIER_THRESHOLD. */
export const DEFAULT_OUTLIER_THRESHOLD: OutlierThreshold = 2;

export type DiscoverView = "all" | "outliers" | "saved";
export type PublishedWindow = "7" | "30" | "90" | "all";
export const PUBLISHED_WINDOWS: PublishedWindow[] = ["7", "30", "90", "all"];

export type DiscoverFilters = {
  network: Network;
  /** creator id or "all" */
  creatorId: string;
  /** days back, or "all" */
  published: PublishedWindow;
  /** epoch ms used for the published window */
  now: number;
  threshold: number;
};

const DAY = 86_400_000;

/** The single predicate that badge, counter and outlier filter share. */
export function isOutlier(signal: { outlier?: number }, threshold: number) {
  return (signal.outlier ?? 0) >= threshold;
}

/** A signal Chris marked to find again. The mark is the timestamp; absent means not saved. */
export function isSaved(signal: { savedAt?: string } | undefined | null) {
  return Boolean(signal?.savedAt);
}

/** Chris' own accounts. Collected like every other creator, shown only in Profile. */
export function isOwned(creator: Pick<Creator, "owned"> | undefined | null) {
  return Boolean(creator?.owned);
}

/**
 * The research corpus: everything except the reels of an owned creator. Discover,
 * Briefing, Format Signals and the evidence packet share this one predicate, so
 * an own upload never lands in the competitor numbers. A signal whose creator is
 * gone stays in; only a known owned creator excludes it.
 */
export function withoutOwned<T extends { creatorId: string }>(signals: T[], creators: Creator[]): T[] {
  const owned = new Set(creators.filter(isOwned).map((creator) => creator.id));
  return signals.filter((signal) => !owned.has(signal.creatorId));
}

function inWindow(signal: Pick<SignalRecord, "publishedAt">, published: PublishedWindow, now: number) {
  if (published === "all") return true;
  return now - new Date(signal.publishedAt).getTime() <= Number(published) * DAY;
}

/** Network, channel and time window: the filters every Discover view shares. */
export function filterScope<T extends RankedSignal>(signals: T[], creators: Creator[], filters: DiscoverFilters): T[] {
  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
  return withoutOwned(signals, creators)
    .filter((signal) => creatorMap.get(signal.creatorId)?.network === filters.network)
    .filter((signal) => filters.creatorId === "all" || signal.creatorId === filters.creatorId)
    .filter((signal) => inWindow(signal, filters.published, filters.now));
}

/** Cards shown by Discover under the active view (unsorted). */
export function filterDiscover<T extends RankedSignal>(
  signals: T[],
  creators: Creator[],
  filters: DiscoverFilters & { view: DiscoverView },
): T[] {
  const scoped = filterScope(signals, creators, filters);
  if (filters.view === "saved") return scoped.filter(isSaved);
  if (filters.view === "outliers") return scoped.filter((signal) => isOutlier(signal, filters.threshold));
  return scoped;
}

/** Stat-block counter. Delegates to the same predicate the outlier view uses. */
export function countOutliers(signals: RankedSignal[], creators: Creator[], filters: DiscoverFilters) {
  return filterDiscover(signals, creators, { ...filters, view: "outliers" }).length;
}

/** Stat-block counter for the saved view. Delegates to the same predicate the view uses. */
export function countSaved(signals: RankedSignal[], creators: Creator[], filters: DiscoverFilters) {
  return filterDiscover(signals, creators, { ...filters, view: "saved" }).length;
}

export type CorpusSnapshot = { creators: Creator[]; signals: SignalRecord[] };

/** Demo fixtures only exist for an empty store. One real creator hides them everywhere. */
export function storeOrDemo(store: CorpusSnapshot, demo: CorpusSnapshot): CorpusSnapshot {
  return store.creators.length > 0 ? store : demo;
}
