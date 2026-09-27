#!/usr/bin/env node
/**
 * `npm run dev:board` (PLAN.md Punkt 46): lokale Convex-Deployment, Next nur auf
 * 127.0.0.1:$BOARD_WEB_PORT und die Bridge auf $BOARD_BRIDGE_PORT. Lädt
 * `.env.local` explizit und bricht ab, wenn ein Port belegt ist. Der Hauptordner
 * auf 3000 und 3211 bleibt unberührt.
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { assertLocalConvex, convexCli, loadBoardEnv, localConvexPorts, portFree, REPO_ROOT, spawnConvexDev } from "./env.mjs";

const env = loadBoardEnv();
try {
  assertLocalConvex(env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const webPort = Number(env.BOARD_WEB_PORT || 3100);
const bridgePort = Number(env.BOARD_BRIDGE_PORT || 3311);
const convexPorts = localConvexPorts();
for (const [label, port] of [["Next", webPort], ["Bridge", bridgePort], ...convexPorts.map((port) => ["Convex lokal", port])]) {
  if (!(await portFree(port))) {
    console.error(`Port ${port} (${label}) ist belegt. Abbruch. Läuft schon ein dev:board?`);
    process.exit(1);
  }
}
for (const key of ["BOARD_ACCESS_TOKEN", "BOARD_BRIDGE_TOKEN", "BOARD_SESSION_SECRET"]) {
  if (!env[key] || env[key].length < 32) {
    console.error(`${key} fehlt oder ist zu kurz (mindestens 32 Zeichen) in .env.local.`);
    process.exit(1);
  }
}

const origins = `http://127.0.0.1:${webPort},http://localhost:${webPort}`;
let buildId = "dev";
try {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" }).trim() ? "+lokal" : "";
  buildId = `${sha}${dirty}`;
} catch {}
const boardEnv = {
  ...env,
  BOARD_WEB_PORT: String(webPort),
  BOARD_BRIDGE_PORT: String(bridgePort),
  BRIDGE_PORT: String(bridgePort),
  BRIDGE_ALLOWED_ORIGINS: origins,
  NEXT_PUBLIC_STRATEGY_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
  BOARD_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
  BOARD_BUILD_ID: buildId,
};

const children = [];
function start(label, color, child) {
  children.push(child);
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    let rest = "";
    stream?.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(`${prefix}${line}\n`);
    });
  }
  child.on("exit", (code, signal) => {
    console.log(`${prefix}beendet (${signal ?? code}). Stoppe alles.`);
    shutdown(code ?? 1);
  });
  return child;
}

/**
 * The Convex CLI leaves its local backend running when it gets SIGTERM. The
 * backend's port belongs to this worktree only, so stopping exactly that process is safe.
 */
function stopLocalBackend() {
  const [port] = convexPorts;
  if (!port) return;
  try {
    const pids = execFileSync("/usr/bin/pgrep", ["-f", `convex-local-backend --port ${port} `], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    for (const pid of pids) process.kill(Number(pid), "SIGTERM");
  } catch {
    // nothing running
  }
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => {
    stopLocalBackend();
    process.exit(code);
  }, 2_500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("convex", "33", spawnConvexDev(boardEnv, { stdio: ["ignore", "pipe", "pipe"] }));

async function waitForConvex() {
  const url = boardEnv.NEXT_PUBLIC_CONVEX_URL.replace(/\/$/, "");
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`${url}/version`);
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

if (!(await waitForConvex())) {
  console.error("Lokale Convex-Deployment antwortet nicht.");
  shutdown(1);
} else {
  try {
    const current = convexCli(["env", "get", "BOARD_ACCESS_TOKEN"], boardEnv).trim();
    if (current !== boardEnv.BOARD_ACCESS_TOKEN) {
      convexCli(["env", "set", "BOARD_ACCESS_TOKEN", boardEnv.BOARD_ACCESS_TOKEN], boardEnv);
      console.log("BOARD_ACCESS_TOKEN in der lokalen Convex-Deployment gesetzt.");
    }
  } catch (error) {
    console.error(`BOARD_ACCESS_TOKEN konnte nicht gesetzt werden: ${error.message}`);
  }
  const nextBin = path.join(REPO_ROOT, "node_modules", ".bin", "next");
  start("web", "36", spawn(nextBin, ["dev", "-H", "127.0.0.1", "-p", String(webPort)], { cwd: REPO_ROOT, env: boardEnv, stdio: ["ignore", "pipe", "pipe"] }));
  start("bridge", "35", spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--watch", "bridge/server.mjs"], { cwd: REPO_ROOT, env: boardEnv, stdio: ["ignore", "pipe", "pipe"] }));
  console.log(`Board: http://127.0.0.1:${webPort}/board · Bridge: http://127.0.0.1:${bridgePort}`);
}
