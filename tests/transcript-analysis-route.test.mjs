import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../app/api/transcript-analyses/route.ts";

test("analysis API rejects a missing signal id before storage", async () => {
  const response = await GET(new Request("http://localhost/api/transcript-analyses"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "signalId is required." });
});

test("analysis API rejects unbounded worker commands before storage or Bridge access", async () => {
  const response = await POST(new Request("http://localhost/api/transcript-analyses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "process", limit: 21 }),
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /limit/i);
});
