import test from "node:test";
import assert from "node:assert/strict";
import { collectForCreator } from "../lib/adapters/sources/apify-instagram.ts";

const creator = { id: "instagram-a", name: "A", handle: "@a", network: "instagram", audience: 1, accent: "#fff", lastCheckedAt: "2026-08-24T10:00:00.000Z" };
const post = (shortCode) => ({ shortCode, timestamp: "2026-08-23T00:00:00.000Z", type: "Video", likesCount: 1, commentsCount: 0 });

test("both streams succeed: merged by shortCode, delta window with overlap", async () => {
  const inputs = [];
  const run = async (_actor, input) => { inputs.push(input); return [post("x"), post("y")]; };
  const records = await collectForCreator(creator, run);
  assert.deepEqual(records.map((r) => r.externalId), ["x", "y"]);
  assert.deepEqual(inputs.map((i) => i.resultsType), ["reels", "posts"]);
  assert.ok(inputs.every((i) => i.onlyPostsNewerThan === "2026-08-23"));
});

test("one failing stream throws with the stream name", async () => {
  const run = async (_actor, input) => { if (input.resultsType === "reels") throw new Error("actor timeout"); return [post("x")]; };
  await assert.rejects(collectForCreator(creator, run), /^Error: reels: actor timeout$/);
});

test("both failing streams are named in one error", async () => {
  const run = async (_actor, input) => { throw new Error(`${input.resultsType} down`); };
  await assert.rejects(collectForCreator(creator, run), /reels: reels down; posts: posts down/);
});
