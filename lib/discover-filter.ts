import type { Creator, Network, RankedSignal, SignalRecord } from "./contracts";

/** Selectable outlier thresholds (plays divided by followers). */
export const OUTLIER_THRESHOLDS = [1.5, 2, 3, 5] as const;
export type OutlierThreshold = (typeof OUTLIER_THRESHOLDS)[number];
/** Default threshold. Re-exported by lib/config.ts as OUTLIER_THRESHOLD. */
export const DEFAULT_OUTLIER_THRESHOLD: OutlierThreshold = 2;

export type DiscoverView = "all" | "outliers" | "saved";

export type DiscoverFilters = {
  network: Network;
  /** creator id or "all" */
  channel: string;
  /** days as string ("7", "30", "90") or "all" */
  published: string;
  /** epoch ms used for the published window */
  now: number;
  threshold: number;
};

const DAY = 86_400_000;

/** The single predicate that badge, counter and outlier filter share. */
export function isOutlier(signal: { outlier?: number }, threshold: number) {
  return (signal.outlier ?? 0) >= threshold;
}

function inWindow(signal: Pick<SignalRecord, "publishedAt">, published: string, now: number) {
  if (published === "all") return true;
  return now - new Date(signal.publishedAt).getTime() <= Number(published) * DAY;
}

/** Network, channel and time window: the filters every Discover view shares. */
export function filterScope<T extends RankedSignal>(signals: T[], creators: Creator[], filters: DiscoverFilters): T[] {
  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
  return signals
    .filter((signal) => creatorMap.get(signal.creatorId)?.network === filters.network)
    .filter((signal) => filters.channel === "all" || signal.creatorId === filters.channel)
    .filter((signal) => inWindow(signal, filters.published, filters.now));
}

/** Cards shown by Discover under the active view (unsorted). */
export function filterDiscover<T extends RankedSignal>(
  signals: T[],
  creators: Creator[],
  filters: DiscoverFilters & { view: DiscoverView },
): T[] {
  const scoped = filterScope(signals, creators, filters);
  if (filters.view === "saved") return [];
  if (filters.view === "outliers") return scoped.filter((signal) => isOutlier(signal, filters.threshold));
  return scoped;
}

/** Stat-block counter. Delegates to the same predicate the outlier view uses. */
export function countOutliers(signals: RankedSignal[], creators: Creator[], filters: DiscoverFilters) {
  return filterDiscover(signals, creators, { ...filters, view: "outliers" }).length;
}

export type Store = { creators: Creator[]; signals: SignalRecord[] };

/** Demo fixtures only exist for an empty store. One real creator hides them everywhere. */
export function mergeStoreWithDemo(store: Store, demo: Store): Store {
  return store.creators.length > 0 ? store : demo;
}
