import test from "node:test";
import assert from "node:assert/strict";
import { demoSignals } from "../lib/demo-data.ts";
import { transcriptDisplayStatus, TRANSCRIPT_STATUS_META } from "../lib/transcript-display.ts";

test("the display mapper keeps no transcript separate from every stored status", () => {
  assert.equal(transcriptDisplayStatus({}), "none");
  assert.equal(transcriptDisplayStatus({ transcript: "  Gesprochener Text. " }), "ready");

  for (const status of ["pending", "silent", "missing", "failed", "ready"]) {
    assert.equal(transcriptDisplayStatus({ transcriptStatus: status }), status);
    assert.ok(TRANSCRIPT_STATUS_META[status].label.length > 0);
  }
});

test("a stored status wins over a stale transcript field", () => {
  assert.equal(transcriptDisplayStatus({ transcript: "old text", transcriptStatus: "failed" }), "failed");
});

test("demo mode includes a ready Reel with timecoded transcript segments", () => {
  const signal = demoSignals.find((item) => item.id === "signal-thumbnail");
  assert.ok(signal);
  assert.equal(signal.format, "reel");
  assert.equal(transcriptDisplayStatus(signal), "ready");
  assert.ok(signal.transcript);
  assert.equal(signal.transcriptSegments?.length, 2);
  assert.deepEqual(signal.transcriptSegments?.[0], {
    start: 0,
    end: 3.8,
    text: "Laute Gestalltung gewinnt nicht automatisch Aufmerksammkeit.",
  });
});
