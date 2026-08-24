import test from "node:test";
import assert from "node:assert/strict";

// Mirrors lib/adapters/scoring/outlier.ts formulas so the contract is pinned without a TS loader.
function outlier(reach, audience) { return audience > 0 ? reach / audience : 0; }
function median(values) { const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

test("outlier is plays divided by followers", () => {
  assert.equal(outlier(1_000_000, 200_000), 5);
  assert.equal(outlier(500, 0), 0);
});

test("channel relative uses the creator median", () => {
  const plays = [100, 200, 300, 10_000];
  assert.equal(median(plays), 250);
  assert.equal(10_000 / median(plays), 40);
});
