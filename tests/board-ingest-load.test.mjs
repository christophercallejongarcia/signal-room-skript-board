import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

async function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test("burst of 100 videos against a slow fake yt-dlp: never more than two processes, overflow gets 429, health stays fast", { timeout: 120_000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sr-board-load-"));
  const log = path.join(home, "ytdlp.jsonl");
  const port = await freePort();
  const token = "b".repeat(64);
  const bridge = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "bridge/server.mjs"], {
    env: { ...process.env, BRIDGE_PORT: String(port), BOARD_BRIDGE_TOKEN: token, SIGNAL_ROOM_BOARD_HOME: home, BOARD_YTDLP_FAKE: "1", FAKE_YTDLP_DELAY_MS: "400", FAKE_YTDLP_LOG: log },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    const headers = { "x-board-bridge-token": token, "content-type": "application/json" };
    for (let i = 0; i < 100; i += 1) {
      try {
        if ((await fetch(`${base}/v1/board/health`, { headers })).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    let probing = true;
    const latencies = [];
    const probe = (async () => {
      while (probing) {
        const started = performance.now();
        const response = await fetch(`${base}/v1/board/health`, { headers });
        assert.equal(response.status, 200);
        latencies.push(performance.now() - started);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();

    const ids = Array.from({ length: 100 }, (_, i) => `SLOW${String(i).padStart(7, "0")}`);
    const statuses = await Promise.all(ids.map((videoId) => fetch(`${base}/v1/board/youtube`, { method: "POST", headers, body: JSON.stringify({ videoId }) }).then((response) => response.status)));
    probing = false;
    await probe;

    const ok = statuses.filter((status) => status === 200).length;
    const full = statuses.filter((status) => status === 429).length;
    assert.equal(ok + full, 100, `unexpected statuses: ${[...new Set(statuses)]}`);
    assert.ok(full > 0, "overflow must be refused");
    assert.ok(ok >= 2 && ok <= 25, `accepted ${ok}`);

    const entries = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const intervals = new Map();
    for (const entry of entries) {
      const interval = intervals.get(entry.pid) ?? {};
      if (entry.at) interval.start = entry.at;
      if (entry.end) interval.end = entry.end;
      intervals.set(entry.pid, interval);
    }
    const points = [...intervals.values()].flatMap(({ start, end }) => [[start, 1], [end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let running = 0;
    let peak = 0;
    for (const [, delta] of points) {
      running += delta;
      peak = Math.max(peak, running);
    }
    assert.ok(peak <= 2, `peak of ${peak} yt-dlp processes`);
    assert.ok(Math.max(...latencies) < 500, `health took ${Math.round(Math.max(...latencies))} ms`);
  } finally {
    bridge.kill("SIGTERM");
  }
});
