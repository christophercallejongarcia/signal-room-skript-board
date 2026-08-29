import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runActor } from "../lib/adapters/sources/apify-client.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/apify-run.json", import.meta.url), "utf8"));
const items = [{ shortCode: "x" }, { shortCode: "y" }];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fake Apify: the start call answers with `first`, every poll with the next of `polls`, the dataset with items. */
function fakeApify({ first, polls = [], dataset = items }) {
  const calls = [];
  const queue = [...polls];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    if (url.includes("/acts/")) return json(first, 201);
    if (url.includes("/actor-runs/")) return json(queue.shift() ?? first);
    if (url.includes("/datasets/")) return json(dataset);
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fetchImpl };
}

test.beforeEach(() => { process.env.APIFY_TOKEN = "t"; });

test("a run that finished inside waitForFinish: items from the dataset, usage from the run object", async () => {
  const apify = fakeApify({ first: fixture });
  const result = await runActor("apify~instagram-scraper", { resultsType: "reels" }, { fetch: apify.fetchImpl });
  assert.deepEqual(result.items, items);
  assert.deepEqual(result.usage, { computeUnits: 0.13804, costUsd: 0.2654 });
  assert.deepEqual(apify.calls.map((c) => c.method), ["POST", "GET"]);
  assert.match(apify.calls[0].url, /\/acts\/apify~instagram-scraper\/runs\?token=t&timeout=300&waitForFinish=60$/);
  assert.match(apify.calls[1].url, /\/datasets\/wmKPijuyDnPZAPRMk\/items\?token=t&clean=true$/);
});

test("a run still going after the start call is polled until it is terminal", async () => {
  const running = { data: { ...fixture.data, status: "RUNNING", statusMessage: "Actor is running" } };
  const apify = fakeApify({ first: running, polls: [running, fixture] });
  const result = await runActor("apify~instagram-scraper", {}, { fetch: apify.fetchImpl });
  assert.equal(result.items.length, 2);
  assert.deepEqual(apify.calls.map((c) => c.url.split("?")[0].split("/v2/")[1]), [
    "acts/apify~instagram-scraper/runs",
    "actor-runs/HG7ML7M8z78YcAPEB",
    "actor-runs/HG7ML7M8z78YcAPEB",
    "datasets/wmKPijuyDnPZAPRMk/items",
  ]);
});

test("a run that ends FAILED throws with the status and never reads the dataset", async () => {
  const apify = fakeApify({ first: { data: { ...fixture.data, status: "FAILED" } } });
  await assert.rejects(runActor("apify~instagram-scraper", {}, { fetch: apify.fetchImpl }), /ended FAILED/);
  assert.ok(apify.calls.every((c) => !c.url.includes("/datasets/")));
});

test("a run object without usage figures yields an empty usage, not zeros", async () => {
  const { stats: _stats, usageTotalUsd: _usd, ...bare } = fixture.data;
  const apify = fakeApify({ first: { data: bare } });
  const result = await runActor("apify~instagram-scraper", {}, { fetch: apify.fetchImpl });
  assert.deepEqual(result.usage, {});
});

test("compute units without a dollar total are priced at the configured rate", async () => {
  const { usageTotalUsd: _usd, ...noTotal } = fixture.data;
  const apify = fakeApify({ first: { data: noTotal } });
  const result = await runActor("apify~instagram-scraper", {}, { fetch: apify.fetchImpl });
  assert.equal(result.usage.computeUnits, 0.13804);
  assert.ok(Math.abs(result.usage.costUsd - 0.13804 * 0.4) < 1e-9);
});

test("a non-2xx start answer surfaces the status and body", async () => {
  const fetchImpl = async () => new Response("no such actor", { status: 404 });
  await assert.rejects(runActor("apify~nope", {}, { fetch: fetchImpl }), /Apify apify~nope failed \(404\): no such actor/);
});

test("missing token fails before any call", async () => {
  delete process.env.APIFY_TOKEN;
  let called = false;
  await assert.rejects(runActor("apify~x", {}, { fetch: async () => { called = true; return json({}); } }), /APIFY_TOKEN/);
  assert.equal(called, false);
});
