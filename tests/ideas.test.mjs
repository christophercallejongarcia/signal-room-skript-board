import test from "node:test";
import assert from "node:assert/strict";
import {
  IDEA_GOAL_MAX,
  IDEA_TITLE_MAX,
  applyStoryboard,
  canTransition,
  claimDevelop,
  newIdea,
  parseStoryboard,
  releaseDevelop,
} from "../lib/ideas.ts";

const NOW = "2026-08-25T09:00:00.000Z";
const LATER = "2026-08-25T09:05:00.000Z";

const storyboard = {
  hook: "Drei Sekunden, ein Beweis.",
  beats: [
    { label: "Setup", detail: "Zeig den Fehler, den alle machen." },
    { label: "Turn", detail: "Zeig den Beweis aus dem Korpus." },
    { label: "Payoff", detail: "Zeig, was der Zuschauer morgen anders macht." },
  ],
  cta: "Speicher das Reel, bevor du es brauchst.",
  caption: "Ein Outlier erklärt, warum der Hook trägt.",
  takeaway: "Der Zuschauer kann den Hook selbst nachbauen.",
};

function captured() {
  return newIdea({ title: "Warum Outlier lügen" }, { id: "idea-1", now: NOW });
}

test("a captured idea starts without a storyboard", () => {
  const idea = captured();
  assert.equal(idea.id, "idea-1");
  assert.equal(idea.title, "Warum Outlier lügen");
  assert.equal(idea.status, "captured");
  assert.equal(idea.createdAt, NOW);
  assert.equal(idea.updatedAt, NOW);
  assert.equal(idea.storyboard, undefined);
  assert.equal(idea.developRunId, undefined);
});

test("a capture keeps the source reel, its link and the creator handle", () => {
  const idea = newIdea(
    {
      title: "Hook aus dem Teardown",
      goal: "Ein Reel",
      sourceSignalId: "ig-42",
      sourceCreator: "@ada",
      sourceUrl: "https://www.instagram.com/reel/abc/",
    },
    { id: "idea-2", now: NOW },
  );
  assert.equal(idea.sourceSignalId, "ig-42");
  assert.equal(idea.sourceCreator, "@ada");
  assert.equal(idea.sourceUrl, "https://www.instagram.com/reel/abc/");
  assert.equal(idea.goal, "Ein Reel");
});

test("a source link that is not https is dropped", () => {
  for (const sourceUrl of ["javascript:alert(1)", "http://example.com/reel", "not a url"]) {
    const idea = newIdea({ title: "Mit Quelle", sourceUrl }, { id: "idea-2b", now: NOW });
    assert.equal(idea.sourceUrl, undefined);
  }
});

test("a capture needs a title", () => {
  assert.throws(() => newIdea({ title: "   " }, { id: "idea-3", now: NOW }), /title is required/);
});

test("a capture bounds title and goal", () => {
  const idea = newIdea(
    { title: "t".repeat(IDEA_TITLE_MAX + 50), goal: "g".repeat(IDEA_GOAL_MAX + 50) },
    { id: "idea-4", now: NOW },
  );
  assert.equal(idea.title.length, IDEA_TITLE_MAX);
  assert.equal(idea.goal.length, IDEA_GOAL_MAX);
});

test("an empty goal stays absent instead of empty", () => {
  const idea = newIdea({ title: "Ohne Ziel", goal: "  " }, { id: "idea-5", now: NOW });
  assert.equal(idea.goal, undefined);
});

test("captured develops or drops, produced never goes back", () => {
  assert.ok(canTransition("captured", "developed"));
  assert.ok(canTransition("captured", "dropped"));
  assert.ok(!canTransition("captured", "produced"));
  assert.ok(canTransition("developed", "developed"));
  assert.ok(canTransition("developed", "produced"));
  assert.ok(!canTransition("produced", "developed"));
  assert.ok(!canTransition("dropped", "captured"));
});

test("a produced idea is not developed again", () => {
  const produced = { ...captured(), status: "produced" };
  assert.throws(() => claimDevelop(produced, "run-a", LATER), /produced to developed/);
});

test("a develop run claims the idea", () => {
  const claimed = claimDevelop(captured(), "run-a", LATER);
  assert.equal(claimed.developRunId, "run-a");
  assert.equal(claimed.status, "captured");
  assert.equal(claimed.updatedAt, LATER);
});

test("a dropped idea cannot be developed", () => {
  const dropped = { ...captured(), status: "dropped" };
  assert.throws(() => claimDevelop(dropped, "run-a", LATER), /dropped to developed/);
});

test("the claimed run writes its storyboard", () => {
  const claimed = claimDevelop(captured(), "run-a", LATER);
  const developed = applyStoryboard(claimed, "run-a", storyboard, { now: LATER, evidenceCount: 7 });
  assert.equal(developed.status, "developed");
  assert.deepEqual(developed.storyboard, storyboard);
  assert.equal(developed.evidenceCount, 7);
  assert.equal(developed.developedAt, LATER);
  assert.equal(developed.developRunId, undefined);
});

test("a second develop run wins and the slow first one is dropped", () => {
  const first = claimDevelop(captured(), "run-a", NOW);
  const second = claimDevelop(first, "run-b", LATER);
  assert.equal(applyStoryboard(second, "run-a", storyboard, { now: LATER, evidenceCount: 3 }), null);
  const settled = applyStoryboard(second, "run-b", storyboard, { now: LATER, evidenceCount: 3 });
  assert.equal(settled.status, "developed");
  assert.equal(settled.evidenceCount, 3);
});

test("a late storyboard never overwrites the newer one", () => {
  const claimed = claimDevelop(captured(), "run-b", NOW);
  const developed = applyStoryboard(claimed, "run-b", storyboard, { now: LATER, evidenceCount: 3 });
  assert.equal(applyStoryboard(developed, "run-a", storyboard, { now: LATER, evidenceCount: 9 }), null);
});

test("a failed run releases only its own claim", () => {
  const claimed = claimDevelop(captured(), "run-a", NOW);
  assert.equal(releaseDevelop(claimed, "run-b", LATER), null);
  const released = releaseDevelop(claimed, "run-a", LATER);
  assert.equal(released.developRunId, undefined);
  assert.equal(released.status, "captured");
});

test("a storyboard needs hook, three beats, cta, caption and takeaway", () => {
  assert.deepEqual(parseStoryboard(storyboard), storyboard);
});

test("a storyboard without three beats is refused", () => {
  assert.throws(() => parseStoryboard({ ...storyboard, beats: storyboard.beats.slice(0, 2) }), /three beats/);
  assert.throws(
    () => parseStoryboard({ ...storyboard, beats: [...storyboard.beats, { label: "Extra", detail: "Zu viel" }] }),
    /three beats/,
  );
});

test("a beat needs a label and a detail", () => {
  const beats = [{ label: "", detail: "x" }, ...storyboard.beats.slice(1)];
  assert.throws(() => parseStoryboard({ ...storyboard, beats }), /beat 1/);
});

test("every storyboard field must carry text", () => {
  for (const field of ["hook", "cta", "caption", "takeaway"]) {
    assert.throws(() => parseStoryboard({ ...storyboard, [field]: "  " }), new RegExp(field));
  }
});

test("a storyboard that is not an object is refused", () => {
  assert.throws(() => parseStoryboard(null), /Storyboard/);
  assert.throws(() => parseStoryboard("hook"), /Storyboard/);
});

test("the caption keeps its line breaks, every other field stays one line", () => {
  const parsed = parseStoryboard({
    ...storyboard,
    caption: "Erste Zeile als Hook.\r\n\n\n\n  Zweite Zeile.  ",
    hook: "Erste\nZeile",
  });
  assert.equal(parsed.caption, "Erste Zeile als Hook.\n\nZweite Zeile.");
  assert.equal(parsed.hook, "Erste Zeile");
});

test("a storyboard drops unknown fields and trims text", () => {
  const parsed = parseStoryboard({ ...storyboard, hook: "  Drei Sekunden  ", extra: "ignoriert" });
  assert.equal(parsed.hook, "Drei Sekunden");
  assert.equal("extra" in parsed, false);
});

const forecast = {
  range: { low: 12_000, high: 48_000 },
  potential: "medium",
  comparableCount: 3,
  risk: "Der Hook verspricht mehr, als das Reel zeigt.",
  tension: "Warum speichern alle einen Teardown, den keiner nachbaut?",
};

test("the develop run writes its forecast next to the storyboard", () => {
  const claimed = claimDevelop(captured(), "run-a", LATER);
  const developed = applyStoryboard(claimed, "run-a", storyboard, { now: LATER, evidenceCount: 7, forecast });
  assert.deepEqual(developed.forecast, forecast);
});

test("a run without a forecast still writes the storyboard and clears the old forecast", () => {
  const first = applyStoryboard(claimDevelop(captured(), "run-a", NOW), "run-a", storyboard, {
    now: NOW,
    evidenceCount: 7,
    forecast,
  });
  const second = applyStoryboard(claimDevelop(first, "run-b", LATER), "run-b", storyboard, {
    now: LATER,
    evidenceCount: 4,
    forecast: null,
  });
  assert.deepEqual(second.storyboard, storyboard);
  assert.equal(second.forecast, undefined);
  assert.equal(second.status, "developed");
});
