import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { refreshCronSlots } from "../lib/refresh-schedule";

const crons = cronJobs();

/**
 * The daily sweep, 10:00 Europe/Berlin. Cron specs are UTC, so one job per UTC
 * hour that can be 10:00 local; the action checks the wall clock and only one
 * of the two does the work on any given day (lib/refresh-schedule.ts).
 */
for (const slot of refreshCronSlots()) {
  crons.cron(`daily sweep (${slot.utcHour}:00 UTC slot)`, slot.spec, internal.refresh.run, {});
}

/**
 * The monthly Format-Review. 03:00 UTC on the first of the month, so the pass
 * sits after the daily refresh and before anyone opens the tab.
 */
crons.cron("monthly format review", "0 3 1 * *", internal.formatReviews.generate, {});

/** Instagram-only Trend-Radar source sweep; the cost guard lives in lib/hashtag-sweep.ts. */
crons.cron("daily Instagram hashtag sweep", "15 7 * * *", internal.hashtagSweep.run, {});

export default crons;
