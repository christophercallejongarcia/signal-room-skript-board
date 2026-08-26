import test from "node:test";
import assert from "node:assert/strict";
import {
  BRIEFING_FRESHNESS_FLOOR,
  applyAngles,
  briefingFreshness,
  briefingId,
  briefingScore,
  buildBriefing,
  selectBriefingSignals,
} from "../lib/briefing.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-26T12:00:00.000Z");

const creators = [
  { id: "small", name: "Small", handle: "@small", network: "instagram", audience: 10_000, accent: "#000" },
  { id: "big", name: "Big", handle: "@big", network: "instagram", audience: 200_000, accent: "#000" },
  { id: "mine", name: "Mine", handle: "@mine", network: "instagram", audience: 5_000, accent: "#000", owned: true },
];

let seq = 0;
function reel(creatorId, plays, hoursAgo, overrides = {}) {
  seq += 1;
  return {
    id: `s${seq}`,
    creatorId,
    title: `Reel ${seq}`,
    caption: `Reel ${seq}\nZweite Zeile`,
    publishedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    views: plays,
    plays,
    likes: 10,
    comments: 2,
    durationSeconds: 30,
    thumbnailSeed: "s",
    topic: "t",
    format: "reel",
    url: `https://www.instagram.com/reel/${seq}/`,
    ...overrides,
  };
}

const options = { now: NOW };

test("freshness runs from 1 at publication down to the floor at the window edge", () => {
  assert.equal(briefingFreshness(0, 24), 1);
  assert.equal(briefingFreshness(24, 24), BRIEFING_FRESHNESS_FLOOR);
  assert.equal(briefingFreshness(12, 24), (1 + BRIEFING_FRESHNESS_FLOOR) / 2);
  // Outside the window the floor holds; the window filter is what drops the signal.
  assert.equal(briefingFreshness(96, 24), BRIEFING_FRESHNESS_FLOOR);
});

test("the score is outlier times freshness", () => {
  assert.equal(briefingScore(4, 0, 24), 4);
  assert.equal(briefingScore(4, 24, 24), 4 * BRIEFING_FRESHNESS_FLOOR);
});

test("a fresher reel outranks an older one of the same outlier", () => {
  assert.ok(briefingScore(2, 2, 24) > briefingScore(2, 20, 24));
});

test("the floor bounds what freshness may decide: twice the outlier ties from the window edge", () => {
  assert.equal(briefingScore(4, 24, 24), briefingScore(2, 0, 24));
  // Anything below twice the outlier loses to the brand new reel, anything above wins.
  assert.ok(briefingScore(3.9, 24, 24) < briefingScore(2, 0, 24));
  assert.ok(briefingScore(4.1, 24, 24) > briefingScore(2, 0, 24));
});

test("the briefing takes the strongest reels of the window, owned accounts excluded", () => {
  const signals = [
    reel("small", 40_000, 2), // 4.0x, fresh
    reel("small", 30_000, 20), // 3.0x, old
    reel("big", 100_000, 1), // 0.5x
    reel("mine", 50_000, 1), // 10x but owned
    reel("small", 90_000, 40), // 9.0x but outside the window
  ];
  const items = selectBriefingSignals(signals, creators, options);

  assert.deepEqual(items.map((item) => item.signalId), ["s1", "s2", "s3"]);
  assert.equal(items[0].creator, "@small");
  assert.equal(items[0].outlier, 4);
  assert.ok(items[0].score > items[1].score);
});

test("only short form travels: an image post never lands on the briefing", () => {
  const signals = [reel("small", 40_000, 2, { format: "post" }), reel("small", 20_000, 2)];
  assert.deepEqual(
    selectBriefingSignals(signals, creators, options).map((item) => item.signalId),
    ["s7"],
  );
});

test("a signal whose creator is gone is not ranked", () => {
  assert.deepEqual(selectBriefingSignals([reel("ghost", 40_000, 2)], creators, options), []);
});

test("the list is cut at the limit", () => {
  const signals = Array.from({ length: 14 }, (_, index) => reel("small", 40_000 - index * 100, 1));
  assert.equal(selectBriefingSignals(signals, creators, options).length, 10);
  assert.equal(selectBriefingSignals(signals, creators, { ...options, limit: 3 }).length, 3);
});

test("the caption excerpt is one bounded line, never the raw caption", () => {
  const [item] = selectBriefingSignals([reel("small", 40_000, 2, { caption: "a\n b   c" })], creators, options);
  assert.equal(item.caption, "a b c");
});

test("one document per day, so a second refresh overwrites the first", () => {
  assert.equal(briefingId(NOW), "briefing-2026-08-26");
  assert.equal(briefingId(NOW + 3 * HOUR), "briefing-2026-08-26");
  assert.notEqual(briefingId(NOW + 24 * HOUR), briefingId(NOW));
});

test("the briefing counts its sources and the candidates it cut from", () => {
  const signals = [reel("small", 40_000, 2), reel("small", 30_000, 3), reel("big", 900_000, 4)];
  const briefing = buildBriefing(signals, creators, { ...options, limit: 2 });

  assert.equal(briefing.id, "briefing-2026-08-26");
  assert.equal(briefing.day, "2026-08-26");
  assert.equal(briefing.windowHours, 24);
  assert.equal(briefing.windowStart, new Date(NOW - 24 * HOUR).toISOString());
  assert.equal(briefing.candidates, 3, "every reel of the window, before the cut");
  assert.equal(briefing.items.length, 2);
  assert.equal(briefing.sources, 2, "distinct creators behind the ranked items");
  assert.equal(briefing.angles, false);
});

test("a window without a single reel still produces a briefing", () => {
  const briefing = buildBriefing([reel("small", 40_000, 100)], creators, options);
  assert.equal(briefing.items.length, 0);
  assert.equal(briefing.sources, 0);
  assert.equal(briefing.candidates, 0);
});

test("the briefing ranks the stored corpus the way the desk does", () => {
  const signals = [reel("small", 40_000, 2), reel("big", 100_000, 2)];
  const briefing = buildBriefing(signals, creators, options);
  assert.deepEqual(briefing.items.map((item) => item.creator), ["@small", "@big"]);
  assert.equal(briefing.items[0].outlier, 4);
});

test("angles are hung on the items positionally and bounded", () => {
  const briefing = buildBriefing([reel("small", 40_000, 2), reel("small", 30_000, 3)], creators, options);
  const angled = applyAngles(briefing, { angles: ["  Dreh es auf   den Mittelstand.  ", "b".repeat(500)] });

  assert.equal(angled.items[0].angle, "Dreh es auf den Mittelstand.");
  assert.equal(angled.items[1].angle.length, 300);
  assert.equal(angled.angles, true);
  assert.equal(briefing.items[0].angle, undefined, "the input briefing is untouched");
});

test("a bridge that failed leaves the briefing standing without angles", () => {
  const briefing = buildBriefing([reel("small", 40_000, 2)], creators, options);
  for (const answer of [null, undefined, {}, { angles: "nope" }, { angles: [] }, { angles: ["   "] }]) {
    const angled = applyAngles(briefing, answer);
    assert.equal(angled.items[0].angle, undefined);
    assert.equal(angled.angles, false);
    assert.equal(angled.items.length, 1);
  }
});

test("an angle list of the wrong length is refused whole, never shifted onto the wrong reel", () => {
  const briefing = buildBriefing([reel("small", 40_000, 2), reel("small", 30_000, 3)], creators, options);
  // The bridge drops an evidence entry without a title before it builds the answer
  // schema, so a short list means the positions no longer line up with the items.
  for (const angles of [["Nur der erste."], ["a", "b", "c"]]) {
    const angled = applyAngles(briefing, { angles });
    assert.equal(angled.angles, false);
    assert.equal(angled.items[0].angle, undefined);
    assert.equal(angled.items[1].angle, undefined);
  }
});

test("a single blank angle in a full list leaves only that item bare", () => {
  const briefing = buildBriefing([reel("small", 40_000, 2), reel("small", 30_000, 3)], creators, options);
  const angled = applyAngles(briefing, { angles: ["Der erste.", "   "] });
  assert.equal(angled.items[0].angle, "Der erste.");
  assert.equal(angled.items[1].angle, undefined);
  assert.equal(angled.angles, true);
});

test("the demo fixtures still fill a briefing, so the tab reads before the first refresh", async () => {
  const { demoCreators, demoSignals } = await import("../lib/demo-data.ts");
  const { DEMO_NOW } = await import("../lib/rank-corpus.ts");
  const briefing = buildBriefing(demoSignals, demoCreators, { now: DEMO_NOW.getTime() });

  assert.ok(briefing.items.length > 0, "demo mode renders an empty tab otherwise");
  assert.ok(briefing.sources > 0);
  assert.equal(briefing.angles, false, "the demo briefing is never written and never asks the bridge");
});
