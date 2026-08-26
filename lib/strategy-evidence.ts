import { OUTLIER_THRESHOLD, STRATEGY_EVIDENCE_LIMIT, STRATEGY_EVIDENCE_WINDOW_DAYS } from "./config.ts";
import type { Creator, RankedSignal, StrategyEvidenceItem } from "./contracts";
import { isOutlier, withoutOwned } from "./discover-filter.ts";

const DAY = 86_400_000;

/** Upper bound for the caption excerpt handed to the Strategy-Provider. */
export const CAPTION_EXCERPT_LENGTH = 280;

/** Collapses the caption to one bounded line. Captions are source text, never instructions. */
export function captionExcerpt(caption: string | undefined, max = CAPTION_EXCERPT_LENGTH) {
  const flat = (caption ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export type EvidenceOptions = {
  /** Epoch ms the window is measured from. */
  now?: number;
  windowDays?: number;
  threshold?: number;
  limit?: number;
};

/**
 * The evidence packet for one strategy run: the strongest outlier reels of the
 * window, newest corpus only. Demo fixtures never reach this; the caller passes
 * the stored corpus.
 */
export function selectEvidence(
  signals: RankedSignal[],
  creators: Creator[],
  options: EvidenceOptions = {},
): StrategyEvidenceItem[] {
  const now = options.now ?? Date.now();
  const windowDays = options.windowDays ?? STRATEGY_EVIDENCE_WINDOW_DAYS;
  const threshold = options.threshold ?? OUTLIER_THRESHOLD;
  const limit = options.limit ?? STRATEGY_EVIDENCE_LIMIT;
  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));

  // Own uploads are research about Chris, not about the niche: Profile reads them.
  return withoutOwned(signals, creators)
    .filter((signal) => signal.format === "reel")
    .filter((signal) => creatorMap.has(signal.creatorId))
    .filter((signal) => now - new Date(signal.publishedAt).getTime() <= windowDays * DAY)
    .filter((signal) => isOutlier(signal, threshold))
    // Rank on the exact factor; rounding is presentation and would collapse neighbours.
    .sort((a, b) => b.outlier - a.outlier || (b.plays ?? b.views) - (a.plays ?? a.views))
    .slice(0, limit)
    .map((signal) => ({
      title: signal.title,
      creator: creatorMap.get(signal.creatorId)!.handle,
      caption: captionExcerpt(signal.caption),
      plays: signal.plays ?? signal.views,
      outlier: Math.round(signal.outlier * 10) / 10,
    }));
}
