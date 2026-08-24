import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cacheCovers,
  coverPath,
  coverUrl,
  isCoverId,
  sniffImageType,
  withCoverUrls,
} from "../lib/adapters/storage/cover-cache.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakeFetch(bodies, calls) {
  return async (url) => {
    calls.push(url);
    const body = bodies[url];
    if (!body) return new Response("nope", { status: 404 });
    return new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } });
  };
}

async function withDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "covers-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const records = [
  { id: "ig-AbC123", externalId: "AbC123", thumbnailUrl: "https://cdn/a.jpg" },
  { id: "ig-Xy_9-z", externalId: "Xy_9-z", thumbnailUrl: "https://cdn/b.jpg" },
  { id: "ig-nourl", externalId: "nourl" },
];

test("first run writes one file per record named by external id", async () => {
  await withDir(async (dir) => {
    const calls = [];
    const result = await cacheCovers(records, { dir, fetch: fakeFetch({ "https://cdn/a.jpg": JPEG, "https://cdn/b.jpg": JPEG }, calls) });
    assert.deepEqual(result, { cached: 2, skipped: 0, failed: 0 });
    assert.deepEqual((await readdir(dir)).sort(), ["AbC123.jpg", "Xy_9-z.jpg"]);
    assert.deepEqual(await readFile(coverPath("AbC123", dir)), JPEG);
  });
});

test("second run is idempotent and fetches nothing", async () => {
  await withDir(async (dir) => {
    const bodies = { "https://cdn/a.jpg": JPEG, "https://cdn/b.jpg": JPEG };
    const first = [];
    await cacheCovers(records, { dir, fetch: fakeFetch(bodies, first) });
    const second = [];
    const result = await cacheCovers(records, { dir, fetch: fakeFetch(bodies, second) });
    assert.equal(first.length, 2);
    assert.equal(second.length, 0);
    assert.deepEqual(result, { cached: 0, skipped: 2, failed: 0 });
  });
});

test("a failed or expired download leaves no file and is retried next run", async () => {
  await withDir(async (dir) => {
    const calls = [];
    const result = await cacheCovers(records, { dir, fetch: fakeFetch({ "https://cdn/a.jpg": JPEG }, calls) });
    assert.deepEqual(result, { cached: 1, skipped: 0, failed: 1 });
    assert.deepEqual(await readdir(dir), ["AbC123.jpg"]);
    const retry = [];
    await cacheCovers(records, { dir, fetch: fakeFetch({ "https://cdn/a.jpg": JPEG, "https://cdn/b.jpg": JPEG }, retry) });
    assert.deepEqual(retry, ["https://cdn/b.jpg"]);
  });
});

test("a body that is not an image is not cached", async () => {
  await withDir(async (dir) => {
    const html = Buffer.from("<html>login</html>");
    const result = await cacheCovers([records[0]], { dir, fetch: fakeFetch({ "https://cdn/a.jpg": html }, []) });
    assert.deepEqual(result, { cached: 0, skipped: 0, failed: 1 });
    assert.deepEqual(await readdir(dir), []);
  });
});

test("cover ids are restricted to safe characters", () => {
  assert.equal(isCoverId("AbC123_-"), true);
  assert.equal(isCoverId("../etc/passwd"), false);
  assert.equal(isCoverId("a/b"), false);
  assert.equal(isCoverId(""), false);
  assert.equal(coverUrl("AbC123"), "/api/covers/AbC123");
});

test("withCoverUrls annotates only cached records", async () => {
  await withDir(async (dir) => {
    await cacheCovers([records[0]], { dir, fetch: fakeFetch({ "https://cdn/a.jpg": JPEG }, []) });
    const annotated = await withCoverUrls(records, dir);
    assert.equal(annotated[0].coverUrl, "/api/covers/AbC123");
    assert.equal(annotated[1].coverUrl, undefined);
    assert.equal(annotated[2].coverUrl, undefined);
  });
});

test("sniffImageType recognises jpeg, png, webp and rejects the rest", () => {
  assert.equal(sniffImageType(JPEG), "image/jpeg");
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImageType(Buffer.from("<html>")), null);
});

test("only https links are fetched; a stored http or file link is never requested", async () => {
  await withDir(async (dir) => {
    const calls = [];
    const result = await cacheCovers(
      [
        { externalId: "h", thumbnailUrl: "http://cdn/a.jpg" },
        { externalId: "f", thumbnailUrl: "file:///etc/passwd" },
      ],
      { dir, fetch: fakeFetch({}, calls) },
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(result, { cached: 0, skipped: 0, failed: 2 });
  });
});

test("a redirecting link is not followed and a body over 5 MB is dropped", async () => {
  await withDir(async (dir) => {
    const redirect = async () => new Response(null, { status: 302, headers: { location: "https://internal/x" } });
    const r1 = await cacheCovers([records[0]], { dir, fetch: redirect });
    assert.deepEqual(r1, { cached: 0, skipped: 0, failed: 1 });
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    const r2 = await cacheCovers([records[0]], { dir, fetch: async () => new Response(big, { status: 200 }) });
    assert.deepEqual(r2, { cached: 0, skipped: 0, failed: 1 });
    assert.deepEqual(await readdir(dir), []);
  });
});
