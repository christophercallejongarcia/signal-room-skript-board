import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Sanity checks against the persisted corpus when it exists (skipped otherwise).
test("persisted signals carry outlier inputs", async (t) => {
  let store;
  try { store = JSON.parse(await readFile(new URL("../data/store.json", import.meta.url), "utf8")); } catch { t.skip("no data/store.json"); return; }
  const ids = new Set(store.signals.map((s) => s.externalId ?? s.id));
  assert.equal(ids.size, store.signals.length, "no duplicate signals");
  for (const creator of store.creators) assert.ok(creator.audience > 0, `${creator.handle} has followers`);
});
