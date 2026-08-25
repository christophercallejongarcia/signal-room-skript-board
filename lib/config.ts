/** Outlier threshold: plays (or views) divided by follower count. 2 = twice the audience. */
export { DEFAULT_OUTLIER_THRESHOLD as OUTLIER_THRESHOLD } from "./discover-filter.ts";
/** Days of history pulled when a creator is first added. */
export const BACKFILL_DAYS = 90;
/** Maximum posts pulled per creator per run. Keeps Apify cost bounded. */
export const MAX_RESULTS_PER_CREATOR = 150;
/** Days of history the Strategy-Provider reads as evidence. */
export const STRATEGY_EVIDENCE_WINDOW_DAYS = 30;
/** How many outlier reels go into one evidence packet. */
export const STRATEGY_EVIDENCE_LIMIT = 10;
/**
 * What a strategy run is for and who reads the result. Your positioning is not
 * the starter's business: set NEXT_PUBLIC_STRATEGY_GOAL and
 * NEXT_PUBLIC_STRATEGY_AUDIENCE in .env.local (gitignored). The defaults are
 * deliberately generic so the shell works before you write your own.
 */
export const STRATEGY_GOAL =
  process.env.NEXT_PUBLIC_STRATEGY_GOAL ||
  "One reel that turns the strongest evidence in the corpus into something the viewer can act on.";
export const STRATEGY_AUDIENCE =
  process.env.NEXT_PUBLIC_STRATEGY_AUDIENCE || "The audience you build for. Describe it in .env.local.";
