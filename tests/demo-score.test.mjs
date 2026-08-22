import assert from "node:assert/strict";
import test from "node:test";

function score({ views, likes, comments, audience, ageHours }) {
  const relativeReach = views / Math.max(audience, 1);
  const velocity = views / Math.max(ageHours, 1);
  const engagement = (likes + comments * 2) / Math.max(views, 1);
  const freshness = 1 / Math.sqrt(ageHours / 24 + 1);
  return Math.round(
    Math.min(
      99,
      Math.min(relativeReach, 3.5) * 12 + Math.log10(velocity + 1) * 6 + engagement * 150 + freshness * 12,
    ) * 10,
  ) / 10;
}

test("relative reach increases the demo score", () => {
  const baseline = score({ views: 40_000, likes: 2_000, comments: 120, audience: 100_000, ageHours: 24 });
  const breakout = score({ views: 240_000, likes: 12_000, comments: 720, audience: 100_000, ageHours: 24 });
  assert.ok(breakout > baseline);
});

test("fresh records outrank identical stale records", () => {
  const fresh = score({ views: 80_000, likes: 5_000, comments: 240, audience: 90_000, ageHours: 8 });
  const stale = score({ views: 80_000, likes: 5_000, comments: 240, audience: 90_000, ageHours: 240 });
  assert.ok(fresh > stale);
});
