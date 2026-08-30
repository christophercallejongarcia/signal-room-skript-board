import test from "node:test";
import assert from "node:assert/strict";
import {
  SlateRefusal,
  ideaFromStart,
  newSlate,
  parseSlateAnswer,
  parseSlateCompose,
  parseSlateDirection,
  parseSlatePosition,
  parseSlateStart,
  replaceStart,
  slateId,
  slateSources,
  withDirection,
} from "../lib/slate.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-30T08:00:00.000Z");

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

const sources = [
  { signalId: "s1", creator: "@small", creatorName: "Small", title: "Nie wieder Meetings ohne Protokoll", caption: "…", plays: 40_000, outlier: 4, url: "https://www.instagram.com/reel/1/" },
  { signalId: "s2", creator: "@big", creatorName: "Big", title: "Die besten drei Agenten", caption: "…", plays: 100_000, outlier: 0.5 },
];

function answer(count, source = 1) {
  return {
    starts: Array.from({ length: count }, (_, i) => ({
      pitch: `Startpunkt ${i + 1}`,
      topic: `Thema ${i + 1}`,
      source,
    })),
  };
}

test("one slate per day: the id carries the day", () => {
  assert.equal(slateId(NOW), "slate-2026-08-30");
  assert.equal(slateId(NOW + 20 * HOUR), "slate-2026-08-31");
});

test("the sources are the short-form reels of the window, owned accounts and untitled reels excluded", () => {
  const signals = [
    reel("small", 40_000, 2),
    reel("big", 100_000, 1),
    reel("mine", 50_000, 1), // owned
    reel("small", 90_000, 40), // outside the window
    reel("small", 10_000, 3, { title: "", caption: "" }), // nothing to cite
    reel("small", 10_000, 4, { format: "post" }),
  ];
  const items = slateSources(signals, creators, { now: NOW });
  assert.deepEqual(items.map((item) => item.signalId), ["s1", "s2"]);
  // Handle and title travel with the source so a start reads without a join.
  assert.equal(items[0].creator, "@small");
});

test("a valid answer becomes exactly count starts, each tied to the source it names", () => {
  const starts = parseSlateAnswer(answer(2, 2), sources, 2);
  assert.equal(starts.length, 2);
  assert.deepEqual(starts.map((start) => start.position), [1, 2]);
  assert.equal(starts[0].pitch, "Startpunkt 1");
  assert.equal(starts[0].topic, "Thema 1");
  assert.equal(starts[0].sourceSignalId, "s2");
  assert.equal(starts[0].sourceCreator, "@big");
  assert.equal(starts[0].sourceTitle, "Die besten drei Agenten");
  assert.equal(starts[0].outlier, 0.5);
  assert.equal(starts[0].plays, 100_000);
  assert.equal("sourceUrl" in starts[0], false);
  assert.equal(parseSlateAnswer(answer(1, 1), sources, 1)[0].sourceUrl, "https://www.instagram.com/reel/1/");
});

test("the answer is refused whole when it holds the wrong number of starts", () => {
  assert.throws(() => parseSlateAnswer(answer(3), sources, 2), /exactly 2/);
  assert.throws(() => parseSlateAnswer({ starts: [] }, sources, 1), /exactly 1/);
  assert.throws(() => parseSlateAnswer(null, sources, 1), /object/);
});

test("a start that names no packet source, or an empty pitch or topic, refuses the answer by position", () => {
  assert.throws(() => parseSlateAnswer(answer(1, 3), sources, 1), /Start 1 .*source/);
  assert.throws(() => parseSlateAnswer(answer(1, 0), sources, 1), /Start 1 .*source/);
  assert.throws(() => parseSlateAnswer(answer(1, "1"), sources, 1), /Start 1 .*source/);
  assert.throws(() => parseSlateAnswer({ starts: [{ pitch: "  ", topic: "x", source: 1 }] }, sources, 1), /Start 1 .*pitch/);
  assert.throws(() => parseSlateAnswer({ starts: [{ pitch: "x", topic: "", source: 1 }] }, sources, 1), /Start 1 .*topic/);
});

test("every returned line is bounded; the Bridge is the untrusted side", () => {
  const long = "x".repeat(5_000);
  const [start] = parseSlateAnswer({ starts: [{ pitch: `  ${long}`, topic: long, source: 1 }] }, sources, 1);
  assert.ok(start.pitch.length < 1_000);
  assert.ok(start.topic.length < 200);
});

test("a single regenerated start keeps its position and the others stay untouched", () => {
  const slate = newSlate({
    id: "slate-2026-08-30",
    now: NOW,
    windowHours: 24,
    sources: 2,
    starts: parseSlateAnswer(answer(3, 1), sources, 3),
  });
  const fresh = parseSlateStart({ pitch: "Neu", topic: "Werkzeug", source: 2 }, sources, 2);
  const later = NOW + HOUR;
  const next = replaceStart(slate, 2, fresh, later);

  assert.equal(next.starts.length, 3);
  assert.equal(next.starts[1].position, 2);
  assert.equal(next.starts[1].pitch, "Neu");
  assert.equal(next.starts[1].sourceSignalId, "s2");
  assert.equal(next.starts[1].regeneratedAt, new Date(later).toISOString());
  assert.deepEqual(next.starts[0], slate.starts[0]);
  assert.deepEqual(next.starts[2], slate.starts[2]);
  assert.equal(next.updatedAt, new Date(later).toISOString());
  // The original document is not mutated.
  assert.equal(slate.starts[1].pitch, "Startpunkt 2");
  assert.throws(() => replaceStart(slate, 4, fresh, later), (error) => error instanceof SlateRefusal && /position 4/.test(error.message));
});

test("a regenerate run without a direction clears what the status line says was applied", () => {
  const slate = newSlate({ id: "slate-2026-08-30", now: NOW, windowHours: 24, sources: 2, starts: parseSlateAnswer(answer(1, 1), sources, 1), direction: "alt" });
  assert.equal(slate.directionApplied, "alt");
  const cleared = withDirection(slate, "", NOW + HOUR);
  const fresh = parseSlateStart({ pitch: "Neu", topic: "x", source: 1 }, sources, 1);
  assert.equal("directionApplied" in replaceStart(cleared, 1, fresh, NOW + 2 * HOUR), false);
  assert.equal(replaceStart(withDirection(slate, "neu", NOW), 1, fresh, NOW).directionApplied, "neu");
});

test("the direction for the next run is stored bounded, and an empty one clears it", () => {
  const slate = newSlate({ id: "slate-2026-08-30", now: NOW, windowHours: 24, sources: 0, starts: [] });
  const directed = withDirection(slate, "  mehr Werkzeug,   weniger Meinung ", NOW + HOUR);
  assert.equal(directed.direction, "mehr Werkzeug, weniger Meinung");
  assert.equal(directed.updatedAt, new Date(NOW + HOUR).toISOString());
  assert.equal("direction" in withDirection(directed, "", NOW + 2 * HOUR), false);
  assert.equal("direction" in slate, false);
});

test("the direction body is parsed once, and only there", () => {
  assert.deepEqual(parseSlateDirection({ id: " slate-2026-08-30 ", direction: "mehr Werkzeug" }), {
    id: "slate-2026-08-30",
    direction: "mehr Werkzeug",
  });
  assert.deepEqual(parseSlateDirection({ id: "slate-2026-08-30" }), { id: "slate-2026-08-30", direction: "" });
  assert.throws(() => parseSlateDirection({ direction: "x" }), /id required/);
  assert.throws(() => parseSlateDirection({ id: "x", direction: 42 }), /direction must be a string/);
});

test("a body that names one start is parsed once, and only there", () => {
  assert.deepEqual(parseSlatePosition({ id: " slate-2026-08-30 ", position: 3 }), { id: "slate-2026-08-30", position: 3 });
  assert.throws(() => parseSlatePosition({ position: 1 }), /id required/);
  assert.throws(() => parseSlatePosition({ id: "x", position: 0 }), /position must be/);
  assert.throws(() => parseSlatePosition({ id: "x", position: 11 }), /position must be/);
  assert.throws(() => parseSlatePosition({ id: "x", position: 1.5 }), /position must be/);
  assert.throws(() => parseSlatePosition({ id: "x", position: "1" }), /position must be/);
  assert.throws(() => parseSlatePosition({ id: "x" }), /position must be/);
});

test("only a literal true rebuilds the day's slate", () => {
  assert.deepEqual(parseSlateCompose({ force: true }), { force: true });
  assert.deepEqual(parseSlateCompose({ force: "true" }), { force: false });
  assert.deepEqual(parseSlateCompose({}), { force: false });
  assert.deepEqual(parseSlateCompose(null), { force: false });
});

test("a start becomes an Idea with its source Signal, and the slate remembers the Idea", () => {
  const slate = newSlate({
    id: "slate-2026-08-30",
    now: NOW,
    windowHours: 24,
    sources: 2,
    starts: parseSlateAnswer(answer(2, 1), sources, 2),
  });
  const { idea, slate: marked } = ideaFromStart(slate, 2, { id: "idea-1", now: new Date(NOW + HOUR).toISOString() });

  assert.equal(idea.id, "idea-1");
  assert.equal(idea.title, "Startpunkt 2");
  assert.equal(idea.status, "captured");
  assert.equal(idea.sourceSignalId, "s1");
  assert.equal(idea.sourceCreator, "@small");
  assert.equal(idea.sourceUrl, "https://www.instagram.com/reel/1/");
  assert.match(idea.goal, /Thema 2/);
  assert.equal(marked.starts[1].ideaId, "idea-1");
  assert.equal("ideaId" in marked.starts[0], false);
  assert.equal("ideaId" in slate.starts[1], false);
  assert.throws(() => ideaFromStart(slate, 9, { id: "idea-2", now: "" }), (error) => error instanceof SlateRefusal && /position 9/.test(error.message));
  // A start already turned into an Idea is not turned twice.
  assert.throws(() => ideaFromStart(marked, 2, { id: "idea-3", now: "" }), (error) => error instanceof SlateRefusal && /already/.test(error.message));
});
