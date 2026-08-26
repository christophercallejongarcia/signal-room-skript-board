import test from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT_PATTERNS,
  UNCLASSIFIED,
  buildFormatSignals,
  classifyCaption,
  hookLine,
} from "../lib/format-signals.ts";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const DAY = 86_400_000;

/** One positive and one negative caption per pattern. Negatives must not land on that pattern. */
const CASES = {
  "kommentiere": {
    yes: ["Kommentiere REEL und ich schicke dir die Vorlage", "Kommentier PLAN, dann kommt der Link"],
    no: ["Ich lese jeden Kommentar unter diesem Reel"],
  },
  "die-besten": {
    yes: ["Die besten Tools fuer deinen Workflow", "Die 5 besten Prompts dieser Woche"],
    no: ["Das sind die Tools, die ich taeglich nutze"],
  },
  "tag-n": {
    yes: ["Tag 14 der Journey zu 10k", "Tag 3: der Aufbau steht"],
    no: ["Jeden Tag ein Reel, seit vierzehn Wochen"],
  },
  "x-vs-y": {
    yes: ["Notion vs. Obsidian fuer den zweiten Kopf", "Claude vs Codex im echten Projekt"],
    no: ["Obsidian ist mein zweiter Kopf geworden"],
  },
  "nie-wieder": {
    yes: ["Nie wieder Copy-Paste zwischen zwei Tools", "Nie mehr manuelle Reports"],
    no: ["Das mache ich immer wieder gerne"],
  },
  "der-geheime": {
    yes: ["Der geheime Trick hinter jedem Outlier", "Die heimliche Bremse in deinem Setup"],
    no: ["Der Trick ist bekannt und trotzdem nutzt ihn keiner"],
  },
  "so-machst-du": {
    yes: ["So baust du dir das in zehn Minuten", "Wie du deinen Korpus sauber haeltst"],
    no: ["Gebaut habe ich das in zehn Minuten"],
  },
  "hoer-auf": {
    yes: ["Hoer auf, deine Captions von Hand zu schreiben", "Stopp mit den Karteikarten"],
    no: ["Ich habe damit aufgehoert, Captions von Hand zu schreiben"],
  },
  "number-first": {
    yes: ["3 Fehler, die deinen Reach kosten", "7 Prompts fuer den Montag"],
    no: ["Fehler Nummer 3 kostet dich den Reach"],
  },
  "question": {
    yes: ["Warum floppen deine Reels?", "Kennst du diesen Shortcut?"],
    no: ["Deine Reels floppen aus genau einem Grund"],
  },
};

test("the pattern list is extensible and carries at least eight patterns", () => {
  assert.ok(FORMAT_PATTERNS.length >= 8, `only ${FORMAT_PATTERNS.length} patterns`);
  const ids = FORMAT_PATTERNS.map((pattern) => pattern.id);
  assert.equal(new Set(ids).size, ids.length, "pattern ids must be unique");
  for (const pattern of FORMAT_PATTERNS) {
    assert.equal(typeof pattern.label, "string");
    assert.ok(pattern.label.length > 0);
    assert.ok(pattern.match instanceof RegExp);
    assert.notEqual(pattern.id, UNCLASSIFIED);
  }
});

test("every pattern in the list is covered by a positive and a negative example", () => {
  for (const pattern of FORMAT_PATTERNS) {
    const entry = CASES[pattern.id];
    assert.ok(entry, `no test case for pattern ${pattern.id}`);
    assert.ok(entry.yes.length > 0 && entry.no.length > 0, `pattern ${pattern.id} needs both signs`);
  }
});

for (const [id, entry] of Object.entries(CASES)) {
  test(`pattern ${id} matches its captions and rejects the counter-example`, () => {
    for (const caption of entry.yes) assert.equal(classifyCaption(caption), id, caption);
    for (const caption of entry.no) assert.notEqual(classifyCaption(caption), id, caption);
  });
}

test("the hook is the first non-empty caption line, leading decoration stripped", () => {
  assert.equal(hookLine("\n\n  🔥 Die besten Tools \nmehr im Profil"), "Die besten Tools");
  assert.equal(hookLine(undefined), "");
  assert.equal(hookLine("   "), "");
});

test("a closing question mark outranks the loose openers below it", () => {
  assert.equal(classifyCaption("Wie kriegst du das hin?"), "question");
  assert.equal(classifyCaption("So einfach war das?"), "question");
  assert.equal(classifyCaption("Notion vs. Obsidian, was nimmst du?"), "question");
  assert.equal(classifyCaption("3 Fehler oder nur einer?"), "question");
});

test("an anchored idiom outranks the question mark", () => {
  assert.equal(classifyCaption("Kommentiere REEL, ok?"), "kommentiere");
  assert.equal(classifyCaption("Nie wieder Copy-Paste, oder?"), "nie-wieder");
});

test("a caption without a known pattern is unclassified", () => {
  assert.equal(classifyCaption("Heute im Studio, ohne grossen Plan"), UNCLASSIFIED);
  assert.equal(classifyCaption(""), UNCLASSIFIED);
  assert.equal(classifyCaption(undefined), UNCLASSIFIED);
});

const creators = [
  { id: "own", name: "Own", handle: "@own", network: "instagram", audience: 1000, accent: "#000" },
  { id: "far", name: "Far", handle: "@far", network: "instagram", audience: 1000, accent: "#000", foreign: true },
];

let seq = 0;
function reel(creatorId, caption, outlier, daysAgo, overrides = {}) {
  seq += 1;
  return {
    id: `s${seq}`,
    creatorId,
    title: caption.split("\n")[0],
    caption,
    publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
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

const options = { now: NOW, threshold: 2, windowDays: 28 };

test("only outlier reels inside the window are read", () => {
  const { own } = buildFormatSignals(
    [
      reel("own", "Die besten Tools", 4, 1),
      reel("own", "Die besten Prompts", 1.9, 1),
      reel("own", "Die besten Ideen", 5, 60),
      reel("own", "Die besten Bilder", 5, 1, { format: "post" }),
      reel("ghost", "Die besten Tricks", 5, 1),
    ],
    creators,
    options,
  );
  assert.equal(own.total, 1);
  assert.deepEqual(own.signals.map((signal) => signal.id), ["die-besten"]);
  assert.equal(own.signals[0].count, 1);
});

test("patterns carry count, average outlier, share, three examples and a weekly line", () => {
  const { own } = buildFormatSignals(
    [
      reel("own", "Die besten Tools", 6, 1),
      reel("own", "Die besten Prompts", 4, 8),
      reel("own", "Die besten Ideen", 2, 15),
      reel("own", "Die besten Wege", 2, 22),
      reel("own", "Nie wieder Copy-Paste", 3, 2),
      reel("own", "Heute im Studio, ohne Plan", 3, 2),
    ],
    creators,
    options,
  );
  assert.equal(own.total, 6);
  const besten = own.signals.find((signal) => signal.id === "die-besten");
  assert.equal(besten.count, 4);
  assert.equal(besten.averageOutlier, 3.5);
  assert.equal(besten.share, 4 / 6);
  assert.equal(besten.examples.length, 3, "at most three examples");
  assert.deepEqual(besten.examples.map((signal) => signal.outlier), [6, 4, 2]);
  // 28-day window, newest week last.
  assert.deepEqual(besten.weeks, [1, 1, 1, 1]);
  const nieWieder = own.signals.find((signal) => signal.id === "nie-wieder");
  assert.deepEqual(nieWieder.weeks, [0, 0, 0, 1], "a single fresh reel sits in the newest bucket");
});

test("patterns sort by average outlier, unclassified stays last with its share", () => {
  const { own } = buildFormatSignals(
    [
      reel("own", "Die besten Tools", 3, 1),
      reel("own", "Nie wieder Copy-Paste", 9, 1),
      reel("own", "Warum floppen deine Reels?", 5, 1),
      reel("own", "Heute im Studio, ohne Plan", 20, 1),
      reel("own", "Ein Tag ohne Struktur", 20, 1),
    ],
    creators,
    options,
  );
  assert.deepEqual(
    own.signals.map((signal) => signal.id),
    ["nie-wieder", "question", "die-besten", UNCLASSIFIED],
  );
  const rest = own.signals.at(-1);
  assert.equal(rest.count, 2);
  assert.equal(rest.share, 2 / 5);
});

test("unclassified is dropped when every reel matched a pattern", () => {
  const { own } = buildFormatSignals([reel("own", "Die besten Tools", 3, 1)], creators, options);
  assert.deepEqual(own.signals.map((signal) => signal.id), ["die-besten"]);
});

test("foreign-niche creators form their own group and stay out of the own numbers", () => {
  const { own, foreign } = buildFormatSignals(
    [
      reel("own", "Die besten Tools", 3, 1),
      reel("far", "Nie wieder Copy-Paste", 9, 1),
      reel("far", "Nie wieder Handarbeit", 9, 2),
    ],
    creators,
    options,
  );
  assert.equal(own.total, 1);
  assert.deepEqual(own.signals.map((signal) => signal.id), ["die-besten"]);
  assert.equal(foreign.total, 2);
  assert.deepEqual(foreign.signals.map((signal) => signal.id), ["nie-wieder"]);
  assert.equal(foreign.signals[0].share, 1);
});

test("the title stands in when a signal carries no caption", () => {
  const { own } = buildFormatSignals(
    [reel("own", "x", 3, 1, { caption: undefined, title: "Die besten Tools" })],
    creators,
    options,
  );
  assert.deepEqual(own.signals.map((signal) => signal.id), ["die-besten"]);
});
