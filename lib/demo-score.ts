import type { Creator, RankedSignal, SignalRecord, SignalScorer } from "./contracts";

const HOUR = 3_600_000;

export function scoreDemoSignal(record: SignalRecord, creator: Creator, now = new Date()): RankedSignal {
  const ageHours = Math.max(1, (now.getTime() - new Date(record.publishedAt).getTime()) / HOUR);
  const relativeReach = record.views / Math.max(creator.audience, 1);
  const velocity = record.views / ageHours;
  const engagement = (record.likes + record.comments * 2) / Math.max(record.views, 1);
  const freshness = 1 / Math.sqrt(ageHours / 24 + 1);
  const score = Math.round(
    Math.min(
      99,
      Math.min(relativeReach, 3.5) * 12 + Math.log10(velocity + 1) * 6 + engagement * 150 + freshness * 12,
    ) * 10,
  ) / 10;

  const reason =
    relativeReach >= 2
      ? "Reaching well beyond its creator's usual audience"
      : velocity >= 3_000
        ? "Moving quickly for its age"
        : "Combining healthy reach with active discussion";

  return {
    ...record,
    score,
    relativeReach: Math.round(relativeReach * 100) / 100,
    velocity: Math.round(velocity),
    outlier: Math.round(relativeReach * 100) / 100,
    channelRelative: 0,
    reason,
  };
}

export const demoScorer: SignalScorer = {
  rank(records, creators, now = new Date()) {
    const creatorsById = new Map(creators.map((creator) => [creator.id, creator]));

    return records
      .map((record) => {
        const creator = creatorsById.get(record.creatorId);
        if (!creator) return null;
        return scoreDemoSignal(record, creator, now);
      })
      .filter((record): record is RankedSignal => record !== null)
      .sort((a, b) => b.score - a.score);
  },
};

export const DEMO_SCORING_NOTE =
  "This transparent sample ranker is intentionally generic. Replace SignalScorer with your own defensible method.";
