import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * The monthly Format-Review. 03:00 UTC on the first of the month, so the pass
 * sits after the daily refresh and before anyone opens the tab.
 */
crons.cron("monthly format review", "0 3 1 * *", internal.formatReviews.generate, {});

export default crons;
