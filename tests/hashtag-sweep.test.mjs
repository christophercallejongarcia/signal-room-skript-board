import test from "node:test";
import assert from "node:assert/strict";
import { runHashtagSweep } from "../lib/hashtag-sweep.ts";

const now = () => new Date("2026-08-22T16:00:00.000Z");
const post = { id: "ig-hashtag-x", externalId: "x", hashtag: "claude", hashtags: ["claude"], title: "Warum Claude hilft", caption: "Warum Claude dir bei der Recherche hilft.", publishedAt: "2026-08-22T12:00:00.000Z", plays: 100, likes: 2, comments: 1, url: "https://www.instagram.com/p/x/", topic: "ki-tools", language: "de", collectedAt: "2026-08-22T16:00:00.000Z" };

function storage() {
  return {
    posts: [],
    runs: [],
    async saveHashtagPosts(posts) {
      this.posts.push(...posts);
      return { inserted: posts.length, updated: 0 };
    },
    async saveRun(run) {
      this.runs.push(run);
    },
  };
}

test("hashtag sweep stores posts and logs its own run type under the cost limit", async () => {
  const store = storage();
  const result = await runHashtagSweep({
    storage: store,
    hashtags: ["#claude"],
    costLimitUsd: 1,
    now,
    collect: async () => ({ posts: [post], usage: { unreported: 0, costUsd: 0.08 } }),
  });
  assert.equal(result.postsAdded, 1);
  assert.equal(store.posts.length, 1);
  assert.equal(store.runs[0].kind, "hashtag-sweep");
  assert.equal(store.runs[0].hashtagsChecked, 1);
  assert.equal(store.runs[0].costLimitUsd, 1);
  assert.deepEqual(store.runs[0].errors, []);
});

test("a sweep above the cost limit is logged as failed and stores no posts", async () => {
  const store = storage();
  await assert.rejects(
    runHashtagSweep({
      storage: store,
      hashtags: ["#claude"],
      costLimitUsd: 0.05,
      now,
      collect: async () => ({ posts: [post], usage: { unreported: 0, costUsd: 0.08 } }),
    }),
    /exceeds the \$0\.050 limit/,
  );
  assert.equal(store.posts.length, 0);
  assert.equal(store.runs[0].status, "failed");
  assert.equal(store.runs[0].usage.costUsd, 0.08);
});

test("a sweep without a verifiable cost fails closed", async () => {
  const store = storage();
  await assert.rejects(
    runHashtagSweep({
      storage: store,
      hashtags: ["#claude"],
      costLimitUsd: 1,
      now,
      collect: async () => ({ posts: [post], usage: { unreported: 1 } }),
    }),
    /verifiable cost/,
  );
  assert.equal(store.posts.length, 0);
  assert.deepEqual(store.runs[0].usage, { unreported: 1 });
});

