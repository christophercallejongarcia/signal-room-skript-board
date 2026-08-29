import test from "node:test";
import assert from "node:assert/strict";
import { collectForCreator } from "../lib/adapters/sources/apify-instagram.ts";

const creator = { id: "instagram-a", name: "A", handle: "@a", network: "instagram", audience: 1, accent: "#fff", lastCheckedAt: "2026-08-24T10:00:00.000Z" };
const post = (shortCode) => ({ shortCode, timestamp: "2026-08-23T00:00:00.000Z", type: "Video", likesCount: 1, commentsCount: 0 });
const usage = { computeUnits: 0.1, costUsd: 0.04 };

test("both streams succeed: merged by shortCode, delta window with overlap", async () => {
  const inputs = [];
  const run = async (_actor, input) => { inputs.push(input); return { items: [post("x"), post("y")], usage }; };
  const { records } = await collectForCreator(creator, run);
  assert.deepEqual(records.map((r) => r.externalId), ["x", "y"]);
  assert.deepEqual(inputs.map((i) => i.resultsType), ["reels", "posts"]);
  assert.ok(inputs.every((i) => i.onlyPostsNewerThan === "2026-08-23"));
});

test("one failing stream throws with the stream name", async () => {
  const run = async (_actor, input) => { if (input.resultsType === "reels") throw new Error("actor timeout"); return { items: [post("x")], usage }; };
  await assert.rejects(collectForCreator(creator, run), /^Error: reels: actor timeout$/);
});

test("both failing streams are named in one error", async () => {
  const run = async (_actor, input) => { throw new Error(`${input.resultsType} down`); };
  await assert.rejects(collectForCreator(creator, run), /reels: reels down; posts: posts down/);
});

test("usage of both streams is summed on the result", async () => {
  const run = async () => ({ items: [post("x")], usage });
  const { usage: total } = await collectForCreator(creator, run);
  assert.equal(total.unreported, 0);
  assert.ok(Math.abs(total.computeUnits - 0.2) < 1e-9);
  assert.ok(Math.abs(total.costUsd - 0.08) < 1e-9);
});

test("a stream without a usage figure is counted as unreported, not as zero", async () => {
  const run = async (_actor, input) => ({ items: [post("x")], usage: input.resultsType === "reels" ? usage : {} });
  const { usage: total } = await collectForCreator(creator, run);
  assert.deepEqual(total, { unreported: 1, computeUnits: 0.1, costUsd: 0.04 });
});
