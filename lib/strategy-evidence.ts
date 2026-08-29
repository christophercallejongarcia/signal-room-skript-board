import { OUTLIER_THRESHOLD, STRATEGY_EVIDENCE_LIMIT, STRATEGY_EVIDENCE_WINDOW_DAYS } from "./config.ts";
import type { Creator, RankedSignal, StrategyEvidenceItem } from "./contracts";
import { isOutlier, withoutOwned } from "./discover-filter.ts";
import { hookOf } from "./hook-source.ts";

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
    // The title is the reel's Hook. With a transcript that is the spoken opening; without one the
    // stored title already is the first caption line, so hookOf would only re-derive it.
    .map((signal) => ({
      title: signal.transcript ? hookOf(signal) || signal.title : signal.title,
      creator: creatorMap.get(signal.creatorId)!.handle,
      caption: captionExcerpt(signal.caption),
      plays: signal.plays ?? signal.views,
      outlier: Math.round(signal.outlier * 10) / 10,
    }));
}

/** Titles are compared as one bounded, lower-cased line on both sides, so a double space or a newline in a stored title never breaks the match. */
function titleKey(title: unknown) {
  return typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 300).toLowerCase() : "";
}

/**
 * The packet entries whose title the Bridge cited, exactly as written; a title
 * the packet does not carry is dropped, and a title cited twice counts once.
 * This is the rule for a Beleg on the Hooks-Board and for a comparable Reel
 * in a Prognose: the app only ever shows Reels it selected itself.
 */
export function citedEvidence(cited: unknown, evidence: StrategyEvidenceItem[], limit = Infinity) {
  const byTitle = new Map(evidence.map((item) => [titleKey(item.title), item]));
  const matched: StrategyEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const title of Array.isArray(cited) ? cited : []) {
    const key = titleKey(title);
    const match = key ? byTitle.get(key) : undefined;
    if (!match || seen.has(key)) continue;
    seen.add(key);
    matched.push(match);
    if (matched.length >= limit) break;
  }
  return matched;
}
