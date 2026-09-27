/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { pollApifyRun, resumeApify, startApify, type ApifyClient } from "../lib/board/apify";
import { ingestYoutube, type IngestDeps } from "../lib/board/youtube-ingest";
import { sha256Hex } from "../lib/board/youtube";

const modules = import.meta.glob("./**/*.ts");
const token = "t".repeat(64);
const VIDEO = "DR60qPkDM2o";

beforeEach(() => {
  vi.stubEnv("BOARD_ACCESS_TOKEN", token);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof convexTest>;

/** The Next-side Convex caller, backed by convex-test. */
function facade(t: T) {
  const ref = (name: string) => {
    const [module, fn] = name.split(":");
    return (anyApi as unknown as Record<string, Record<string, never>>)[module][fn];
  };
  return {
    query: async <R,>(name: string, args: Record<string, unknown> = {}) => (await t.query(ref(name), { token, ...args })) as R,
    mutation: async <R,>(name: string, args: Record<string, unknown> = {}) => (await t.mutation(ref(name), { token, ...args })) as R,
  };
}

function bridgeReturning(...answers: Array<Awaited<ReturnType<IngestDeps["fetchBridge"]>>>): IngestDeps["fetchBridge"] {
  const queue = [...answers];
  return vi.fn(async () => queue.shift() ?? answers.at(-1)!);
}

const okAnswer = (text = "Das reine Bedienen von Software stirbt.") => ({
  status: 200,
  data: { meta: { title: "Claude Code ist KRANK!", channelTitle: "Jonas Keil", channelId: "UCPicjtG0UwZ7n5HrpqRw-Vw", views: 392_601, uploadDate: "20260506", durationSec: 1476 }, transcript: { text, source: "auto-de", lang: "de-orig" }, noCaptions: false, channelViews: [10, 51_000, 51_000, 90_000] },
});

async function source(t: T) {
  return (await t.query(api.boardYoutube.getSources, { token, videoIds: [VIDEO] }))[0];
}

describe("state machine", () => {
  test("ingest publishes the transcript atomically with metadata and channel factor", async () => {
    const t = convexTest(schema, modules);
    const outcome = await ingestYoutube(VIDEO, { deps: { convex: facade(t), fetchBridge: bridgeReturning(okAnswer()), now: () => Date.now() } });
    expect(outcome.status).toBe("ready");
    const stored = await source(t);
    expect(stored).toMatchObject({ transcriptStatus: "ready", title: "Claude Code ist KRANK!", views: 392_601, channelMedianViews: 51_000, outlier: 7.7, publishedAt: "2026-05-06" });
    expect(stored.activeVersion.chars).toBe(39);
    const transcript = await t.query(api.boardYoutube.getTranscript, { token, videoId: VIDEO });
    expect(transcript?.text).toBe("Das reine Bedienen von Software stirbt.");
    expect(transcript?.hash).toBe(await sha256Hex("Das reine Bedienen von Software stirbt."));
  });

  test("a second ingest joins: ready stays ready, a live pending is not claimed twice", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(api.boardYoutube.claim, { token, opsVersion: 1, videoId: VIDEO, retry: false });
    expect(first.action).toBe("claimed");
    expect((await t.mutation(api.boardYoutube.claim, { token, opsVersion: 1, videoId: VIDEO, retry: false })).action).toBe("pending");
    vi.setSystemTime(new Date("2026-09-27T10:03:01Z"));
    const expired = await t.mutation(api.boardYoutube.claim, { token, opsVersion: 1, videoId: VIDEO, retry: false });
    expect(expired.action).toBe("claimed");
    expect(expired.claimId).not.toBe(first.claimId);
  });

  test("a late old worker writes only into its own version and never changes the active one", async () => {
    const t = convexTest(schema, modules);
    const old = await t.mutation(api.boardYoutube.claim, { token, opsVersion: 1, videoId: VIDEO, retry: false });
    vi.setSystemTime(new Date("2026-09-27T10:04:00Z"));
    await ingestYoutube(VIDEO, { deps: { convex: facade(t), fetchBridge: bridgeReturning(okAnswer("Neue Fassung.")), now: () => Date.now() } });
    const active = (await source(t)).activeVersion;
    await t.mutation(api.boardYoutube.writeChunk, { token, opsVersion: 1, videoId: VIDEO, versionId: old.claimId!, index: 0, text: "Alte Fassung." });
    const late = await t.mutation(api.boardYoutube.publish, { token, opsVersion: 1, videoId: VIDEO, claimId: old.claimId!, chunkCount: 1, hash: await sha256Hex("Alte Fassung."), chars: 13, source: "auto-de" });
    expect(late.published).toBe(false);
    expect((await source(t)).activeVersion).toEqual(active);
    expect((await t.query(api.boardYoutube.getTranscript, { token, videoId: VIDEO }))?.text).toBe("Neue Fassung.");
    await expect(t.mutation(api.boardYoutube.writeChunk, { token, opsVersion: 1, videoId: VIDEO, versionId: active.versionId, index: 0, text: "x" })).rejects.toThrow(/unveränderlich/);
  });

  test("an abort in the middle of writing chunks leaves no ready", async () => {
    const t = convexTest(schema, modules);
    const claim = await t.mutation(api.boardYoutube.claim, { token, opsVersion: 1, videoId: VIDEO, retry: false });
    await t.mutation(api.boardYoutube.writeChunk, { token, opsVersion: 1, videoId: VIDEO, versionId: claim.claimId!, index: 0, text: "Teil eins " });
    const partial = await t.mutation(api.boardYoutube.publish, { token, opsVersion: 1, videoId: VIDEO, claimId: claim.claimId!, chunkCount: 2, hash: "x", chars: 20, source: "auto-de" });
    expect(partial.published).toBe(false);
    expect((await source(t)).transcriptStatus).toBe("pending");
    expect(await t.query(api.boardYoutube.getTranscript, { token, videoId: VIDEO })).toBeNull();
    const wrongHash = await t.mutation(api.boardYoutube.publish, { token, opsVersion: 1, videoId: VIDEO, claimId: claim.claimId!, chunkCount: 1, hash: "falsch", chars: 10, source: "auto-de" });
    expect(wrongHash.published).toBe(false);
  });

  test("error → retry → ready, and no-captions is final for yt-dlp", async () => {
    const t = convexTest(schema, modules);
    const deps = { convex: facade(t), fetchBridge: bridgeReturning({ status: 502, data: { error: "yt-dlp ist fehlgeschlagen: Video unavailable" } }, okAnswer()), now: () => Date.now() };
    expect((await ingestYoutube(VIDEO, { deps })).status).toBe("fetch-failed");
    expect((await source(t)).error).toMatch(/Video unavailable/);
    expect((await ingestYoutube(VIDEO, { deps })).status).toBe("fetch-failed");
    expect((await ingestYoutube(VIDEO, { retry: true, deps })).status).toBe("ready");

    const other = "NOCAPS12345";
    const noCaps = { convex: facade(t), fetchBridge: bridgeReturning({ status: 200, data: { meta: { title: "Stumm" }, transcript: null, noCaptions: true } }), now: () => Date.now() };
    expect((await ingestYoutube(other, { deps: noCaps })).status).toBe("no-captions");
    expect((await ingestYoutube(other, { retry: true, deps: noCaps })).status).toBe("no-captions");
    expect(noCaps.fetchBridge).toHaveBeenCalledTimes(1);
  });

  test("a full bridge queue answers 429 and frees the claim for the next try", async () => {
    const t = convexTest(schema, modules);
    const deps = { convex: facade(t), fetchBridge: bridgeReturning({ status: 429, data: { error: "Warteschlange voll, gleich erneut." }, retryAfter: "5" }, okAnswer()), now: () => Date.now() };
    const queued = await ingestYoutube(VIDEO, { deps });
    expect(queued).toMatchObject({ status: "queued", retryAfter: 5 });
    expect((await ingestYoutube(VIDEO, { retry: true, deps })).status).toBe("ready");
  });
});

describe("Apify fallback", () => {
  function fakeClient(overrides: Partial<ApifyClient> = {}) {
    const calls = { start: 0 };
    const client: ApifyClient = {
      async startRun() {
        calls.start += 1;
        return { id: `run-${calls.start}`, status: "RUNNING" };
      },
      async getRun(id) {
        return { id, status: "SUCCEEDED", defaultDatasetId: "ds-1", usageTotalUsd: 0.012 };
      },
      async getItems() {
        return [{ transcript_text: "Transkript aus Apify." }];
      },
      ...overrides,
    };
    return { client, calls };
  }

  async function noCaptions(t: T) {
    await ingestYoutube(VIDEO, { deps: { convex: facade(t), fetchBridge: bridgeReturning({ status: 200, data: { meta: {}, transcript: null, noCaptions: true } }), now: () => Date.now() } });
  }

  test("a double click starts one run; the transcript arrives with its cost", async () => {
    const t = convexTest(schema, modules);
    await noCaptions(t);
    const { client, calls } = fakeClient();
    const tasks: Promise<unknown>[] = [];
    const deps = { convex: facade(t), client, background: (task: Promise<unknown>) => tasks.push(task) };
    const first = await startApify(VIDEO, "click-aaaa1111", deps);
    const same = await startApify(VIDEO, "click-aaaa1111", deps);
    const other = await startApify(VIDEO, "click-bbbb2222", deps);
    expect([first.action, same.action, other.action]).toEqual(["created", "existing", "busy"]);
    expect(calls.start).toBe(1);
    await Promise.all(tasks);
    expect((await source(t)).transcriptStatus).toBe("ready");
    expect((await t.query(api.boardApify.latest, { token, videoId: VIDEO }))).toMatchObject({ status: "succeeded", costUsd: 0.012, actorRunId: "run-1" });
  });

  test("crash before the actorRunId: after 5 minutes unknown, nothing is bought again without a new click", async () => {
    const t = convexTest(schema, modules);
    await noCaptions(t);
    const { client, calls } = fakeClient({
      async startRun() {
        throw new Error("Next ist mitten im Start gestorben");
      },
    });
    await expect(startApify(VIDEO, "click-cccc3333", { convex: facade(t), client })).rejects.toThrow(/gestorben/);
    expect((await source(t)).transcriptStatus).toBe("apify-pending");
    vi.setSystemTime(new Date("2026-09-27T10:05:01Z"));
    await resumeApify(VIDEO, { convex: facade(t), client: () => client });
    expect((await source(t)).transcriptStatus).toBe("apify-unknown");
    expect((await source(t)).error).toMatch(/möglicherweise schon bezahlt/);
    await resumeApify(VIDEO, { convex: facade(t), client: () => client });
    expect(calls.start).toBe(0);
    const again = await startApify(VIDEO, "click-dddd4444", { convex: facade(t), client: fakeClient().client, background: () => {} });
    expect(again.action).toBe("created");
  });

  test("crash after the actorRunId: the next status poll resumes the run and publishes it", async () => {
    const t = convexTest(schema, modules);
    await noCaptions(t);
    vi.stubEnv("APIFY_TOKEN", "apify-test-token");
    let polls = 0;
    const { client } = fakeClient({
      async getRun(id) {
        polls += 1;
        return polls < 2 ? { id, status: "RUNNING" } : { id, status: "SUCCEEDED", defaultDatasetId: "ds-1", usageTotalUsd: 0.02 };
      },
    });
    // `poll: false` = Next dies right after storing the actorRunId.
    await startApify(VIDEO, "click-eeee5555", { convex: facade(t), client, poll: false });
    const request = await t.query(api.boardApify.latest, { token, videoId: VIDEO });
    expect(request?.actorRunId).toBe("run-1");
    await pollApifyRun(request!, { convex: facade(t), client, sleep: async () => {} });
    expect((await source(t)).transcriptStatus).toBe("ready");
    expect((await t.query(api.boardYoutube.getTranscript, { token, videoId: VIDEO }))?.text).toBe("Transkript aus Apify.");
  });
});
