import test from "node:test";
import assert from "node:assert/strict";
import { buildTrendRadar, classifyTopic, isGermanCaption } from "../lib/trend-radar.ts";

const now = new Date("2026-08-22T16:00:00.000Z").getTime();
const creators = [
  { id: "c1", name: "One", handle: "@one", network: "instagram", audience: 1000, accent: "#fff" },
  { id: "c2", name: "Two", handle: "@two", network: "instagram", audience: 1000, accent: "#fff" },
  { id: "owned", name: "Mine", handle: "@mine", network: "instagram", audience: 1000, accent: "#fff", owned: true },
];

const hashtagPost = (id, topic, publishedAt, plays, hashtag = "kiagenten") => ({
  id: `ig-hashtag-${id}`,
  externalId: id,
  hashtag,
  hashtags: [hashtag],
  title: `Post ${id}`,
  caption: "Warum dieses Thema für dich wichtig ist",
  publishedAt,
  plays,
  likes: 1,
  comments: 1,
  url: `https://www.instagram.com/p/${id}/`,
  topic,
  language: "de",
  collectedAt: "2026-08-22T16:00:00.000Z",
});

test("topic rules and German gate are deterministic", () => {
  assert.equal(classifyTopic("#kiagenten und Agent Workflow"), "ki-agenten");
  assert.equal(classifyTopic("#vibecoding mit Cursor"), "vibe-coding");
  assert.equal(isGermanCaption("So nutzt du Claude für deine Arbeit."), true);
  assert.equal(isGermanCaption("How to use Claude for your work."), false);
});

test("momentum compares posts and plays with the previous week and opportunity applies the coverage gap", () => {
  const radar = buildTrendRadar({
    creators,
    posts: [
      hashtagPost("new-1", "ki-agenten", "2026-08-22T10:00:00.000Z", 600),
      hashtagPost("new-2", "ki-agenten", "2026-08-20T10:00:00.000Z", 400),
      hashtagPost("old-1", "ki-agenten", "2026-08-14T10:00:00.000Z", 100),
    ],
    signals: [
      { id: "s1", creatorId: "c1", title: "KI-Agenten für Teams", topic: "KI-Agenten", publishedAt: "2026-08-21T10:00:00.000Z" },
      { id: "s2", creatorId: "owned", title: "KI-Agenten intern", topic: "KI-Agenten", publishedAt: "2026-08-21T10:00:00.000Z" },
    ],
    sourceHashtags: ["#kiagenten"],
  }, { now });
  const topic = radar.topics[0];
  assert.equal(topic.currentPosts, 2);
  assert.equal(topic.previousPosts, 1);
  assert.equal(topic.currentPlays, 1000);
  assert.equal(topic.previousPlays, 100);
  assert.equal(topic.postsMomentum, 50);
  assert.equal(topic.playsMomentum, 90);
  assert.equal(topic.momentum, 70);
  assert.equal(topic.coveredCreators, 1);
  assert.equal(topic.trackedCreators, 2);
  assert.equal(topic.coverage, 0.5);
  assert.equal(topic.coverageGap, 0.5);
  assert.equal(topic.opportunity, 35);
  assert.deepEqual(radar.sourceHashtags, ["#kiagenten"]);
});

