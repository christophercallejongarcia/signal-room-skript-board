import test from "node:test";
import assert from "node:assert/strict";
import {
  SHARE_EPSILON,
  buildFormatReview,
  diffPatterns,
  findRisingCreators,
  formatReviewId,
  previousReview,
} from "../lib/format-review.ts";
import { UNCLASSIFIED } from "../lib/format-signals.ts";

const DAY = 86_400_000;
const MONTH_ONE = Date.parse("2026-07-01T00:00:00.000Z");
const MONTH_TWO = Date.parse("2026-08-01T00:00:00.000Z");

const creators = [
  { id: "own", name: "Own", handle: "@own", network: "instagram", audience: 100_000, accent: "#000" },
  { id: "small", name: "Small", handle: "@small", network: "instagram", audience: 10_000, accent: "#000" },
  { id: "tiny", name: "Tiny", handle: "@tiny", network: "instagram", audience: 4_000, accent: "#000" },
  { id: "big", name: "Big", handle: "@big", network: "instagram", audience: 250_000, accent: "#000" },
  { id: "far", name: "Far", handle: "@far", network: "instagram", audience: 8_000, accent: "#000", foreign: true },
];

let seq = 0;
function reel(creatorId, caption, outlier, daysAgo, now, overrides = {}) {
  seq += 1;
  return {
    id: `s${seq}`,
    creatorId,
    title: caption.split("\n")[0],
    caption,
    publishedAt: new Date(now - daysAgo * DAY).toISOString(),
    views: 1000,
    plays: 1000,
    likes: 0,
    comments: 0,
    durationSeconds: 20,
    thumbnailSeed: "s",
    topic: "t",
    format: "reel",
    score: 0,
    relativeReach: 0,
    velocity: 0,
    reason: "",
    outlier,
    channelRelative: 0,
    ...overrides,
  };
}

const snapshot = (id, count, share, averageOutlier, label = id) => ({ id, label, count, share, averageOutlier });

test("a pattern absent last month is new, one absent this month is gone", () => {
  const patterns = diffPatterns([snapshot("kommentiere", 3, 0.5, 6)], [snapshot("nie-wieder", 2, 1, 4)]);
  const kommentiere = patterns.find((pattern) => pattern.id === "kommentiere");
  assert.equal(kommentiere.move, "new");
  assert.equal(kommentiere.previousCount, 0);
  assert.equal(kommentiere.shareDelta, 0.5);
  const gone = patterns.find((pattern) => pattern.id === "nie-wieder");
  assert.equal(gone.move, "gone");
  assert.equal(gone.count, 0);
  assert.equal(gone.share, 0);
  assert.equal(gone.averageOutlier, 0);
  assert.equal(gone.shareDelta, -1);
  assert.equal(gone.label, "nie-wieder", "a gone pattern keeps the label it was reviewed under");
});

test("without a previous review every pattern reads as new", () => {
  const patterns = diffPatterns([snapshot("kommentiere", 3, 0.5, 6)], null);
  assert.deepEqual(patterns.map((pattern) => pattern.move), ["new"]);
});

test("a share that moved less than one point is flat", () => {
  const [pattern] = diffPatterns([snapshot("question", 5, 0.5, 3)], [snapshot("question", 4, 0.5 + SHARE_EPSILON / 2, 3)]);
  assert.equal(pattern.move, "flat");
  assert.equal(pattern.countDelta, 1, "the count still carries its move");
});

test("share decides the move, not the raw count", () => {
  // Twice the reels, but a smaller slice of a corpus that grew faster.
  const [pattern] = diffPatterns([snapshot("question", 8, 0.2, 3)], [snapshot("question", 4, 0.4, 3)]);
  assert.equal(pattern.move, "down");
  assert.equal(pattern.countDelta, 4);
  assert.equal(pattern.shareDelta, -0.2);
});

test("deltas carry count, share and average outlier and are rounded for reading", () => {
  const [pattern] = diffPatterns([snapshot("die-besten", 4, 2 / 3, 4.25)], [snapshot("die-besten", 2, 1 / 3, 3.1)]);
  assert.equal(pattern.share, 0.667);
  assert.equal(pattern.previousShare, 0.333);
  assert.equal(pattern.shareDelta, 0.334);
  assert.equal(pattern.countDelta, 2);
  assert.equal(pattern.outlierDelta, 1.2);
  assert.equal(pattern.move, "up");
});

test("winners come first, unclassified stays last whichever way it moved", () => {
  const patterns = diffPatterns(
    [snapshot(UNCLASSIFIED, 9, 0.6, 3), snapshot("question", 2, 0.1, 3), snapshot("kommentiere", 4, 0.3, 5)],
    [snapshot(UNCLASSIFIED, 1, 0.1, 3), snapshot("question", 5, 0.6, 3), snapshot("kommentiere", 3, 0.3, 5)],
  );
  assert.deepEqual(patterns.map((pattern) => pattern.id), ["kommentiere", "question", UNCLASSIFIED]);
});

/** Month one: four outlier reels in the niche. */
function stateOne() {
  const now = MONTH_ONE;
  return [
    reel("own", "Die besten Tools", 4, 2, now),
    reel("own", "Die besten Prompts", 3, 9, now),
    reel("own", "Nie wieder Copy-Paste", 6, 4, now),
    reel("own", "Warum floppen deine Reels?", 2, 11, now),
    reel("own", "Die besten Ideen von damals", 9, 200, now),
    reel("own", "Die besten Bilder", 9, 1, now, { format: "post" }),
    reel("own", "Die besten Nichtausreisser", 1, 1, now),
  ];
}

/** Month two: die-besten grows, question shrinks, nie-wieder is gone, kommentiere appears. */
function stateTwo() {
  const now = MONTH_TWO;
  return [
    reel("own", "Die besten Tools 2026", 5, 3, now),
    reel("own", "Die besten Prompts 2026", 3, 6, now),
    reel("own", "Die besten Wege dahin", 4, 12, now),
    reel("own", "Warum klappt das nicht?", 2, 8, now),
    reel("small", "Kommentiere PLAN und du bekommst die Vorlage", 7, 5, now),
  ];
}

const options = { now: MONTH_ONE, windowDays: 28, threshold: 2 };

test("the first review reads the window and marks every pattern as new", () => {
  const review = buildFormatReview(stateOne(), creators, null, options);
  assert.equal(review.total, 4, "only outlier reels of the window, reels only");
  assert.equal(review.previousTotal, 0);
  assert.equal(review.previousReviewId, undefined);
  assert.equal(review.windowDays, 28);
  assert.equal(review.threshold, 2);
  assert.equal(review.periodEnd, new Date(MONTH_ONE).toISOString());
  assert.equal(review.periodStart, new Date(MONTH_ONE - 28 * DAY).toISOString());
  assert.equal(review.id, "format-review-2026-07-01");
  assert.deepEqual(new Set(review.patterns.map((pattern) => pattern.move)), new Set(["new"]));
  const besten = review.patterns.find((pattern) => pattern.id === "die-besten");
  assert.equal(besten.count, 2);
  assert.equal(besten.share, 0.5);
  assert.equal(besten.averageOutlier, 3.5);
});

test("the second review diffs against the first: two fixture states, one document", () => {
  const first = buildFormatReview(stateOne(), creators, null, options);
  const review = buildFormatReview(stateTwo(), creators, first, { ...options, now: MONTH_TWO });

  assert.equal(review.id, "format-review-2026-08-01");
  assert.equal(review.previousReviewId, first.id);
  assert.equal(review.total, 5);
  assert.equal(review.previousTotal, 4);

  const byId = new Map(review.patterns.map((pattern) => [pattern.id, pattern]));
  assert.deepEqual(review.patterns.map((pattern) => pattern.id), ["kommentiere", "die-besten", "question", "nie-wieder"]);

  assert.equal(byId.get("kommentiere").move, "new");
  assert.equal(byId.get("kommentiere").count, 1);

  const besten = byId.get("die-besten");
  assert.equal(besten.move, "up");
  assert.equal(besten.count, 3);
  assert.equal(besten.previousCount, 2);
  assert.equal(besten.share, 0.6);
  assert.equal(besten.shareDelta, 0.1);
  assert.equal(besten.averageOutlier, 4);
  assert.equal(besten.outlierDelta, 0.5);

  const question = byId.get("question");
  assert.equal(question.move, "down");
  assert.equal(question.shareDelta, -0.05);

  const gone = byId.get("nie-wieder");
  assert.equal(gone.move, "gone");
  assert.equal(gone.count, 0);
  assert.equal(gone.previousCount, 1);
  assert.equal(gone.label, "Nie wieder X", "the label survives from the month the pattern was still there");
});

test("a review is stable: the same corpus twice diffs to nothing but flat", () => {
  const first = buildFormatReview(stateOne(), creators, null, options);
  const again = buildFormatReview(stateOne(), creators, first, options);
  assert.deepEqual(new Set(again.patterns.map((pattern) => pattern.move)), new Set(["flat"]));
  assert.deepEqual(again.patterns.map((pattern) => pattern.shareDelta), [0, 0, 0]);
});

const risingOptions = { now: MONTH_TWO, windowDays: 28, threshold: 2, smallAudience: 50_000, risingLimit: 3 };

test("rising creators are small accounts whose outlier carries a named pattern", () => {
  const now = MONTH_TWO;
  const rising = findRisingCreators(
    [
      reel("small", "Kommentiere PLAN", 7, 2, now),
      reel("tiny", "Nie wieder Copy-Paste", 5, 3, now),
      reel("big", "Die besten Tools", 40, 2, now),
      reel("tiny", "Heute im Studio, ohne Plan", 30, 1, now),
      reel("small", "Die besten Prompts", 1.5, 2, now),
      reel("small", "Kommentiere REEL", 12, 400, now),
    ],
    creators,
    [{ id: "kommentiere", move: "new" }, { id: "nie-wieder", move: "flat" }],
    risingOptions,
  );
  const ids = rising.map((entry) => entry.creatorId);
  assert.ok(!ids.includes("big"), "a 250k account is not a small creator");
  assert.deepEqual(ids, ["small", "tiny"], "unclassified, sub-threshold and out-of-window reels are not a signal");
  assert.equal(rising[0].handle, "@small");
  assert.equal(rising[0].patternId, "kommentiere");
  assert.equal(rising[0].patternMove, "new");
  assert.equal(rising[0].outlier, 7);
  assert.equal(rising[0].foreign, false);
});

test("a creator appears once, with their strongest reel", () => {
  const now = MONTH_TWO;
  const rising = findRisingCreators(
    [reel("small", "Die besten Tools", 3, 2, now), reel("small", "Die besten Prompts", 9, 1, now)],
    creators,
    [],
    risingOptions,
  );
  assert.equal(rising.length, 1);
  assert.equal(rising[0].outlier, 9);
  assert.equal(rising[0].title, "Die besten Prompts");
});

test("a creator on a pattern that is new this month outranks a stronger reel on an old one", () => {
  const now = MONTH_TWO;
  const rising = findRisingCreators(
    [reel("small", "Kommentiere PLAN", 4, 2, now), reel("tiny", "Die besten Tools", 20, 1, now)],
    creators,
    [{ id: "kommentiere", move: "new" }, { id: "die-besten", move: "flat" }],
    risingOptions,
  );
  assert.deepEqual(rising.map((entry) => entry.creatorId), ["small", "tiny"]);
});

test("foreign-niche creators are carried with their mark, and the list is capped", () => {
  const now = MONTH_TWO;
  const rising = findRisingCreators(
    [
      reel("far", "Nie wieder Handarbeit", 8, 2, now),
      reel("small", "Die besten Tools", 7, 2, now),
      reel("tiny", "Warum floppt das?", 6, 2, now),
    ],
    creators,
    [],
    { ...risingOptions, risingLimit: 2 },
  );
  assert.equal(rising.length, 2);
  assert.deepEqual(rising.map((entry) => entry.creatorId), ["far", "small"]);
  assert.equal(rising[0].foreign, true);
});

test("the review carries its rising creators", () => {
  const review = buildFormatReview(
    [...stateTwo(), reel("far", "Nie wieder Handarbeit", 8, 2, MONTH_TWO)],
    creators,
    null,
    { ...options, now: MONTH_TWO },
  );
  assert.deepEqual(review.risingCreators.map((entry) => entry.creatorId), ["far", "small"]);
  assert.equal(review.total, 5, "the foreign reel stays out of the niche numbers");
});

test("a shape no own-niche outlier carries is new, which is how a foreign account gets read", () => {
  const now = MONTH_TWO;
  const rising = findRisingCreators(
    [reel("far", "Nie wieder Handarbeit", 8, 2, now)],
    creators,
    // The niche diff of that month: nie-wieder is not in it, nobody in the niche used it.
    [{ id: "die-besten", move: "flat" }],
    risingOptions,
  );
  assert.equal(rising[0].patternMove, "new");
  assert.equal(rising[0].patternLabel, "Nie wieder X", "the label comes off the pattern list, not off the diff");
});

test("a pattern reported gone does not come back as new the month after", () => {
  const gone = diffPatterns([snapshot("question", 4, 1, 3)], [snapshot("nie-wieder", 2, 1, 4)]);
  assert.equal(gone.find((pattern) => pattern.id === "nie-wieder").move, "gone");

  // Third generation: nie-wieder is still absent, and the review that reported it gone is the baseline.
  const after = diffPatterns([snapshot("question", 4, 1, 3)], gone);
  assert.deepEqual(after.map((pattern) => pattern.id), ["question"], "a pattern at zero on both sides leaves the list");
});

test("a rerun on the same day diffs against last month, not against itself", () => {
  const first = buildFormatReview(stateOne(), creators, null, options);
  const second = buildFormatReview(stateTwo(), creators, first, { ...options, now: MONTH_TWO });
  assert.equal(formatReviewId(MONTH_TWO), second.id);

  const previous = previousReview([second, first], MONTH_TWO);
  assert.equal(previous.id, first.id, "the document this run overwrites is not its own baseline");
  const rerun = buildFormatReview(stateTwo(), creators, previous, { ...options, now: MONTH_TWO });
  assert.deepEqual(rerun.patterns, second.patterns, "the rerun reports the same month over month move");
});

test("the first ever run has nothing to diff against", () => {
  assert.equal(previousReview([], MONTH_TWO), null);
});
