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
/** The only AI endpoint the app knows. Browser and server routes both go here (ADR-0004). */
export const STRATEGY_BRIDGE_URL = process.env.NEXT_PUBLIC_STRATEGY_BRIDGE_URL || "http://127.0.0.1:3211";
/** Days of history the Format Signals tab reads. Matches the backfill horizon. */
export const FORMAT_WINDOW_DAYS = 90;
/** Example reels shown per Format Signal. */
export const FORMAT_EXAMPLE_LIMIT = 3;
/** A creator below this follower count counts as small in the monthly Format-Review. */
export const FORMAT_REVIEW_SMALL_AUDIENCE = 50_000;
/** Small creators listed per Format-Review. */
export const FORMAT_REVIEW_RISING_LIMIT = 5;
/** Hours of history one daily Briefing covers. */
export const BRIEFING_WINDOW_HOURS = 24;
/** Reels one Briefing carries. */
export const BRIEFING_LIMIT = 10;
/** Bound for one "Chris angle" the Bridge returns. The Bridge is the untrusted side. */
export const BRIEFING_ANGLE_MAX = 300;
/** Caption characters a Briefing item keeps. Shorter than the evidence excerpt: the list reads at a glance. */
export const BRIEFING_CAPTION_EXCERPT = 200;
/** Briefings kept in the picker. Two weeks of mornings. */
export const BRIEFING_HISTORY = 14;
/** Longest input the Hooks board accepts, in characters as pasted. */
export const HOOK_INPUT_MAX = 20_000;
/** How many hooks one run may ask for. */
export const HOOK_COUNTS = [5, 10, 15] as const;
/** From this many characters an input reads as a transcript rather than a one liner. */
export const HOOK_TRANSCRIPT_MIN = 500;
/** Outlier reels cited under one hook variant. */
export const HOOK_EVIDENCE_PER_VARIANT = 2;
/** Hook runs kept in the history rail. */
export const HOOK_RUN_HISTORY = 20;
/** Bounds for one line the Bridge returns on a hooks run. The Bridge is the untrusted side. */
export const HOOK_LINE_MAX = 200;
export const HOOK_RATIONALE_MAX = 400;
export const HOOK_DIRECTION_MAX = 500;
/** Characters of the input the history rail keeps. The board itself is the run's payload. */
export const HOOK_SOURCE_EXCERPT = 240;
