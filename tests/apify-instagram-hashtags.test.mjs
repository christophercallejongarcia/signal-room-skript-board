import test from "node:test";
import assert from "node:assert/strict";
import { collectHashtagPosts, configuredInstagramHashtags } from "../lib/adapters/sources/apify-instagram-hashtags.ts";

const usage = { computeUnits: 0.2, costUsd: 0.08 };
const post = (shortCode, caption, extra = {}) => ({
  shortCode,
  caption,
  timestamp: "2026-08-22T12:00:00.000Z",
  hashtags: ["claude"],
  videoPlayCount: 1200,
  likesCount: 40,
  commentsCount: 5,
  ownerUsername: "creator",
  ...extra,
});

test("configured hashtag values are normalised, deduplicated and bounded", () => {
  assert.deepEqual(configuredInstagramHashtags("#Claude, #claude, #vibecoding, , #KI-Agenten"), ["claude", "vibecoding", "ki-agenten"]);
});

test("the Instagram adapter requests posts, filters English captions and classifies German topics", async () => {
  const calls = [];
  const run = async (actor, input) => {
    calls.push([actor, input]);
    return {
      items: [
        post("de-1", "So nutzt du Claude für deine Recherche", { hashtags: ["claude", "kiagenten"] }),
        post("en-1", "How to use Claude for your workflow"),
        post("de-1", "Dupliziert und wird nur einmal gespeichert"),
        { caption: "Kein Shortcode, also verwerfen", timestamp: "2026-08-22T12:00:00.000Z" },
      ],
      usage,
    };
  };

  const result = await collectHashtagPosts(["#claude", "#vibecoding"], run, new Date("2026-08-22T16:00:00.000Z"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "apify~instagram-scraper");
  assert.deepEqual(calls[0][1].hashtags, ["claude", "vibecoding"]);
  assert.equal(calls[0][1].resultsType, "posts");
  assert.equal(calls[0][1].onlyPostsNewerThan, "14 days");
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].id, "ig-hashtag-de-1");
  assert.equal(result.posts[0].topic, "ki-agenten");
  assert.equal(result.posts[0].language, "de");
  assert.deepEqual(result.usage, { unreported: 0, computeUnits: 0.2, costUsd: 0.08 });
});

test("a German caption without a delivered hashtag still uses the requested hashtag", async () => {
  const run = async () => ({ items: [post("fallback", "Warum du dieses KI-Tool heute testen solltest", { hashtags: [] })], usage });
  const { posts } = await collectHashtagPosts(["#kitools"], run);
  assert.equal(posts[0].hashtag, "kitools");
  assert.equal(posts[0].topic, "ki-tools");
});
