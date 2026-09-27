import fs from "node:fs";
import path from "node:path";
import { boardFile, ensureBoardDir } from "./paths.mjs";

/**
 * Structured event log (PLAN.md point 42a): one JSON line per event in
 * `~/.signal-room/board/logs/events-<YYYY-MM-DD>.jsonl`. Never content,
 * prompts, transcripts or tokens: only the whitelisted fields below survive.
 * Files older than 14 days go, and the oldest go first while the folder is over 50 MB.
 */
const FIELDS = ["instanceId", "layer", "deployment", "runId", "requestId", "boardId", "engine", "engineVersion", "phase", "durationMs", "code", "status", "count"];
export const LOG_RETENTION_DAYS = 14;
export const LOG_MAX_BYTES = 50 * 1024 * 1024;

export function logDir() {
  return boardFile("logs");
}

export function sanitizeEvent(event) {
  const clean = { time: new Date(event.time ?? Date.now()).toISOString() };
  for (const key of FIELDS) {
    const value = event[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === "string") clean[key] = value.slice(0, 120);
  }
  return clean;
}

let lastRotation = 0;

export function rotateLogs({ now = Date.now(), dir = logDir() } = {}) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((name) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
  } catch {
    return;
  }
  const cutoff = new Date(now - LOG_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  const kept = [];
  for (const name of files) {
    if (name.slice(7, 17) < cutoff) fs.rmSync(path.join(dir, name), { force: true });
    else kept.push(name);
  }
  let total = kept.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);
  while (total > LOG_MAX_BYTES && kept.length > 1) {
    const oldest = kept.shift();
    total -= fs.statSync(path.join(dir, oldest)).size;
    fs.rmSync(path.join(dir, oldest), { force: true });
  }
}

export function logEvent(event) {
  try {
    const dir = ensureBoardDir("logs");
    const clean = sanitizeEvent(event);
    fs.appendFileSync(path.join(dir, `events-${clean.time.slice(0, 10)}.jsonl`), `${JSON.stringify(clean)}\n`, { mode: 0o600 });
    if (Date.now() - lastRotation > 3_600_000) {
      lastRotation = Date.now();
      rotateLogs({ dir });
    }
  } catch {
    // Logging never breaks a request.
  }
}
