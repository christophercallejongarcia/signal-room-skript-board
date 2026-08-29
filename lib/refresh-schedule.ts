/**
 * When the daily sweep runs. The schedule is one local time in one zone; the
 * Convex cron only speaks UTC, so convex/crons.ts registers one job per UTC hour
 * that can be that local hour, and the job asks isRefreshHour before it works.
 * Tracked Channels asks nextRefreshAt for the "Next refresh" box.
 */
export const REFRESH_HOUR = 10;
export const REFRESH_TIME_ZONE = "Europe/Berlin";
/** How the UI names the zone next to a time. Derived, so a zone change cannot leave the label lying. */
export const REFRESH_ZONE_LABEL = REFRESH_TIME_ZONE.split("/").pop() ?? REFRESH_TIME_ZONE;

/** UTC offsets, in hours, the zone takes over the year. Berlin: CET (+1) and CEST (+2). */
const ZONE_OFFSETS_HOURS = [1, 2];

const DAY_MS = 86_400_000;

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

/** Wall-clock parts of an instant in REFRESH_TIME_ZONE. */
function zonedParts(at: Date): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REFRESH_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
}

/** The instant at which the zone's wall clock reads the given date at REFRESH_HOUR:00. */
function zonedInstant(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day, REFRESH_HOUR);
  // Offset between the guess read as wall clock and the wall clock it actually shows; one correction is exact away from a DST switch, and the switch never falls on REFRESH_HOUR.
  const shown = zonedParts(new Date(guess));
  const asUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
  return new Date(guess - (asUtc - guess));
}

/** The next instant strictly after now at which the sweep fires. */
export function nextRefreshAt(now: Date): Date {
  const today = zonedParts(now);
  const candidate = zonedInstant(today.year, today.month, today.day);
  if (candidate.getTime() > now.getTime()) return candidate;
  const tomorrow = zonedParts(new Date(now.getTime() + DAY_MS));
  return zonedInstant(tomorrow.year, tomorrow.month, tomorrow.day);
}

/** True when the zone's wall clock is in the REFRESH_HOUR hour. The cron's guard. */
export function isRefreshHour(now: Date): boolean {
  return zonedParts(now).hour === REFRESH_HOUR;
}

/** One cron slot per offset the zone takes, so one of them is REFRESH_HOUR local on any day. */
export type RefreshSlot = { utcHour: number; spec: string };

export function refreshCronSlots(): RefreshSlot[] {
  return [...ZONE_OFFSETS_HOURS]
    .sort((a, b) => b - a)
    .map((offset) => REFRESH_HOUR - offset)
    .map((utcHour) => ({ utcHour, spec: `0 ${utcHour} * * *` }));
}
