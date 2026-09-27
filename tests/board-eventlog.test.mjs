import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOG_MAX_BYTES, rotateLogs, sanitizeEvent } from "../lib/board/eventlog.mjs";

test("the event log keeps only whitelisted metadata, never content", () => {
  const clean = sanitizeEvent({ time: 0, runId: "run-1", engine: "claude", durationMs: 12, prompt: "geheim", transcript: "x", token: "t", text: "Antwort", code: "timeout" });
  assert.deepEqual(Object.keys(clean).sort(), ["code", "durationMs", "engine", "runId", "time"]);
});

test("rotation drops files older than 14 days and the oldest while over 50 MB", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-board-logs-"));
  const now = Date.parse("2026-09-27T12:00:00Z");
  fs.writeFileSync(path.join(dir, "events-2026-09-01.jsonl"), "{}\n");
  fs.writeFileSync(path.join(dir, "events-2026-09-20.jsonl"), Buffer.alloc(LOG_MAX_BYTES));
  fs.writeFileSync(path.join(dir, "events-2026-09-27.jsonl"), "{}\n");
  fs.writeFileSync(path.join(dir, "fremd.txt"), "bleibt");
  rotateLogs({ now, dir });
  assert.deepEqual(fs.readdirSync(dir).sort(), ["events-2026-09-27.jsonl", "fremd.txt"]);
});
