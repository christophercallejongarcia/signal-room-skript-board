/** Outlier threshold: plays (or views) divided by follower count. 2 = twice the audience. */
export { DEFAULT_OUTLIER_THRESHOLD as OUTLIER_THRESHOLD } from "./discover-filter";
/** Days of history pulled when a creator is first added. */
export const BACKFILL_DAYS = 90;
/** Maximum posts pulled per creator per run. Keeps Apify cost bounded. */
export const MAX_RESULTS_PER_CREATOR = 150;
