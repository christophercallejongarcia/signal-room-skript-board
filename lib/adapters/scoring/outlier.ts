// Relative imports so both `node --test` and the Convex bundler can load this file without the "@/" alias.
import type { Creator, RankedSignal, SignalRecord, SignalScorer } from "../../contracts";
import { isOutlier } from "../../discover-filter.ts";

export { isOutlier };

const HOUR = 3_600_000;

export function reach(record: SignalRecord) {
  return record.plays ?? record.views ?? 0;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round = (value: number) => Math.round(value * 100) / 100;

export function describeOutlier(outlier: number, channelRelative: number) {
  const parts: string[] = [];
  if (outlier > 0) parts.push(`${outlier.toFixed(1)}x follower reach`);
  if (channelRelative > 0) parts.push(`${channelRelative.toFixed(1)}x channel median`);
  // No verdict word here: whether a signal counts as an outlier depends on the threshold the person selected in the UI.
  if (parts.length === 0) return "No reach data yet";
  return parts.join(", ");
}

/**
 * Outlier scorer. outlier = plays / followers (5.0 means five times the audience).
 * channelRelative = plays / median plays of the same creator in the retained corpus.
 */
export const outlierScorer: SignalScorer = {
  rank(records, creators, now = new Date()) {
    const creatorsById = new Map(creators.map((creator) => [creator.id, creator]));
    const medians = new Map<string, number>();
    for (const creator of creators) {
      medians.set(creator.id, median(records.filter((r) => r.creatorId === creator.id).map(reach)));
    }

    return records
      .map((record): RankedSignal | null => {
        const creator = creatorsById.get(record.creatorId);
        if (!creator) return null;
        const value = reach(record);
        const outlier = creator.audience > 0 ? value / creator.audience : 0;
        const baseline = medians.get(creator.id) ?? 0;
        const channelRelative = baseline > 0 ? value / baseline : 0;
        const ageHours = Math.max(1, (now.getTime() - new Date(record.publishedAt).getTime()) / HOUR);
        const velocity = value / ageHours;
        const score = round(Math.min(99, outlier * 10 + channelRelative * 5 + Math.log10(velocity + 1) * 4));
        return {
          ...record,
          score,
          relativeReach: round(outlier),
          velocity: Math.round(velocity),
          outlier: round(outlier),
          channelRelative: round(channelRelative),
          reason: describeOutlier(outlier, channelRelative),
        };
      })
      .filter((record): record is RankedSignal => record !== null)
      .sort((a, b) => b.outlier - a.outlier || b.score - a.score);
  },
};
