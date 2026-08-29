import test from "node:test";
import assert from "node:assert/strict";
import { REFRESH_HOUR, REFRESH_TIME_ZONE, REFRESH_ZONE_LABEL, isRefreshHour, nextRefreshAt, refreshCronSlots } from "../lib/refresh-schedule.ts";

test("the sweep is pinned to 10:00 Europe/Berlin", () => {
  assert.equal(REFRESH_HOUR, 10);
  assert.equal(REFRESH_TIME_ZONE, "Europe/Berlin");
  assert.equal(REFRESH_ZONE_LABEL, "Berlin");
});

test("next refresh today when it is still before 10:00 Berlin (summer, CEST = UTC+2)", () => {
  const now = new Date("2026-08-29T05:30:00.000Z"); // 07:30 Berlin
  assert.equal(nextRefreshAt(now).toISOString(), "2026-08-29T08:00:00.000Z");
});

test("next refresh tomorrow once 10:00 Berlin has passed", () => {
  const now = new Date("2026-08-29T08:00:00.000Z"); // exactly 10:00 Berlin: the run is firing, the next one is tomorrow
  assert.equal(nextRefreshAt(now).toISOString(), "2026-08-30T08:00:00.000Z");
  const later = new Date("2026-08-29T21:00:00.000Z"); // 23:00 Berlin
  assert.equal(nextRefreshAt(later).toISOString(), "2026-08-30T08:00:00.000Z");
});

test("winter time moves the instant to 09:00 UTC (CET = UTC+1)", () => {
  const now = new Date("2026-01-15T03:00:00.000Z");
  assert.equal(nextRefreshAt(now).toISOString(), "2026-01-15T09:00:00.000Z");
});

test("the day the clocks go back still lands on 10:00 local", () => {
  // 2026-10-25: CEST ends at 03:00 Berlin. Late on the 24th (UTC+2), the next run on the 25th is at UTC+1.
  const now = new Date("2026-10-24T22:00:00.000Z");
  assert.equal(nextRefreshAt(now).toISOString(), "2026-10-25T09:00:00.000Z");
});

test("the guard fires only in the 10:00 Berlin hour, whichever UTC hour that is", () => {
  assert.equal(isRefreshHour(new Date("2026-08-29T08:00:00.000Z")), true); // summer: 08:00 UTC
  assert.equal(isRefreshHour(new Date("2026-08-29T09:00:00.000Z")), false); // summer: the 09:00 UTC slot is 11:00 Berlin
  assert.equal(isRefreshHour(new Date("2026-01-15T09:00:00.000Z")), true); // winter: 09:00 UTC
  assert.equal(isRefreshHour(new Date("2026-01-15T08:00:00.000Z")), false); // winter: the 08:00 UTC slot is 09:00 Berlin
});

test("one cron slot per UTC hour that can be 10:00 Berlin", () => {
  assert.deepEqual(refreshCronSlots(), [{ utcHour: 8, spec: "0 8 * * *" }, { utcHour: 9, spec: "0 9 * * *" }]);
});
