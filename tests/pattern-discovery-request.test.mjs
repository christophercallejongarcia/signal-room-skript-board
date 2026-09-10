import test from "node:test";
import assert from "node:assert/strict";
import { parsePatternDiscoveryRequest } from "../lib/pattern-discovery-run.ts";

test("pattern discovery accepts one bounded comparison scope and rejects unknown or oversized input", () => {
  assert.deepEqual(parsePatternDiscoveryRequest({ sourceSignalIds: ["ig-a", "ig-a", "ig-b"], market: "de", niche: "core", topic: "KI-Agenten", ageBucket: "8-30", owned: false }), {
    sourceSignalIds: ["ig-a", "ig-b"], market: "de", niche: "core", topic: "KI-Agenten", ageBucket: "8-30", owned: false,
  });
  assert.throws(() => parsePatternDiscoveryRequest({ sourceSignalIds: [], market: "de", niche: "core", topic: "x", ageBucket: "8-30", owned: false }), /between 1 and 100/i);
  assert.throws(() => parsePatternDiscoveryRequest({ sourceSignalIds: ["ig-a"], market: "fr", niche: "core", topic: "x", ageBucket: "8-30", owned: false }), /market/i);
  assert.throws(() => parsePatternDiscoveryRequest({ sourceSignalIds: ["ig-a"], market: "de", niche: "core", topic: "x", ageBucket: "8-30", owned: false, surprise: true }), /unexpected/i);
});
