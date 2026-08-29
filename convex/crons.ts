import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { refreshCronSpecs } from "../lib/refresh-schedule";

const crons = cronJobs();

/**
 * The daily sweep, 10:00 Europe/Berlin. Cron specs are UTC, so one job per UTC
 * hour that can be 10:00 local; the action checks the wall clock and only one
 * of the two does the work on any given day (lib/refresh-schedule.ts).
 */
for (const spec of refreshCronSpecs()) {
  crons.cron(`daily refresh (${spec.split(" ")[1]}:00 UTC slot)`, spec, internal.refresh.run, {});
}

/**
 * The monthly Format-Review. 03:00 UTC on the first of the month, so the pass
 * sits after the daily refresh and before anyone opens the tab.
 */
crons.cron("monthly format review", "0 3 1 * *", internal.formatReviews.generate, {});

export default crons;
