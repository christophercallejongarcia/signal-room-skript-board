#!/usr/bin/env node
/**
 * `npm run test:e2e:board [playwright-args]` (PLAN.md Punkt 105).
 *
 * Isolation: Temp-Ordner mit eigener anonymer lokaler Convex-Deployment,
 * Marker-Datei, Temp-`YTOS_ROOT`, Temp-Board-Home für `~/.signal-room/board`,
 * ohne `APIFY_TOKEN`, Bridge mit `BOARD_ENGINE_FAKE=1` und `BOARD_YTDLP_FAKE=1`.
 * Vor Seed und Aufräumen wird geprüft, dass Convex auf 127.0.0.1 läuft und der
 * Marker im Temp-Ordner liegt, sonst Abbruch. Next läuft als Produktions-Build
 * (`.next`), damit es nicht mit `next dev` (`.next/dev`) kollidiert.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnvFile, portFree, REPO_ROOT } from "./env.mjs";

const MARKER = "SR-BOARD-E2E-MARKER";

/** The safety check before seed and cleanup (plan point 105). Exported for its own unit test. */
export function assertE2eTarget({ convexUrl, root, marker }) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(convexUrl ?? "")) throw new Error(`E2E-Abbruch: Convex-URL ${convexUrl} ist nicht 127.0.0.1.`);
  if (!root || !path.resolve(root).startsWith(fs.realpathSync(os.tmpdir()))) throw new Error("E2E-Abbruch: Arbeitsordner liegt nicht im Temp-Verzeichnis.");
  const file = path.join(root, MARKER);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8").trim() !== marker) throw new Error("E2E-Abbruch: Marker fehlt oder passt nicht.");
  if (!fs.existsSync(path.join(root, "project", ".convex", "local", "default", "config.json"))) throw new Error("E2E-Abbruch: Convex-Zustand liegt nicht im Temp-Ordner.");
}

function cleanEnv() {
  const env = { ...process.env };
  for (const key of ["CONVEX_DEPLOYMENT", "NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CONVEX_SITE_URL", "CONVEX_DEPLOY_KEY", "APIFY_TOKEN", "BOARD_ACCESS_TOKEN", "BOARD_BRIDGE_TOKEN", "BOARD_SESSION_SECRET"]) delete env[key];
  return env;
}

async function freePort(start) {
  for (let port = start; port < start + 50; port += 1) if (await portFree(port)) return port;
  throw new Error(`Kein freier Port ab ${start}.`);
}

async function waitFor(url, { timeoutMs = 120_000, headers } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} antwortet nicht.`);
}

/** Same arguments the Convex CLI uses (convex/dist/cli.bundle.cjs, runLocalBackend), plus `--interface 127.0.0.1`. */
function localBackendCommand(project) {
  const dir = path.join(project, ".convex", "local", "default");
  const config = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
  const binary = path.join(os.homedir(), ".cache", "convex", "binaries", config.backendVersion, "convex-local-backend");
  return {
    command: binary,
    args: [
      "--port", String(config.ports.cloud),
      "--site-proxy-port", String(config.ports.site),
      "--interface", "127.0.0.1",
      "--instance-name", config.deploymentName,
      "--instance-secret", config.instanceSecret,
      "--local-storage", path.join(dir, "convex_local_storage"),
      "--beacon-tag", "cli-anonymous-dev",
      path.join(dir, "convex_local_backend.sqlite3"),
    ],
  };
}

const children = [];
function start(label, command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const log = fs.createWriteStream(path.join(options.logDir, `${label}.log`));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  return child;
}

function stopAll(convexPort) {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  if (convexPort) {
    try {
      const pids = execFileSync("/usr/bin/pgrep", ["-f", `convex-local-backend --port ${convexPort} `], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
      for (const pid of pids) process.kill(Number(pid), "SIGTERM");
    } catch {}
  }
}

async function main() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sr-board-e2e-")));
  const marker = randomBytes(12).toString("hex");
  fs.writeFileSync(path.join(root, MARKER), marker);
  const project = path.join(root, "project");
  const logDir = path.join(root, "logs");
  const home = path.join(root, "board-home");
  const ytos = path.join(root, "ytos");
  for (const dir of [project, logDir, home, path.join(ytos, "videos")]) fs.mkdirSync(dir, { recursive: true });
  // A symlinked convex/ breaks the CLI bundler ("found wrong number of app bundles"), so copy it.
  fs.cpSync(path.join(REPO_ROOT, "convex"), path.join(project, "convex"), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "lib"), path.join(project, "lib"));
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(project, "node_modules"));
  fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(project, "package.json"));
  console.log(`E2E-Arbeitsordner: ${root}`);

  const env = cleanEnv();
  const convexBin = path.join(REPO_ROOT, "node_modules", ".bin", "convex");
  const convexEnv = { ...env, CONVEX_AGENT_MODE: "anonymous" };
  const pushed = spawnSync(convexBin, ["dev", "--once", "--typecheck", "disable", "--codegen", "disable"], { cwd: project, env: convexEnv, encoding: "utf8", timeout: 180_000 });
  const push = `${pushed.stdout}${pushed.stderr}`;
  if (pushed.status !== 0 || !/Convex functions ready/.test(push)) throw new Error(`E2E-Abbruch: Push in die Test-Deployment fehlgeschlagen.\n${push.slice(-500)}`);
  const projectEnv = parseEnvFile(fs.readFileSync(path.join(project, ".env.local"), "utf8"));
  const convexUrl = projectEnv.NEXT_PUBLIC_CONVEX_URL;
  const convexPort = Number(new URL(convexUrl).port);
  assertE2eTarget({ convexUrl, root, marker });

  let exitCode = 1;
  try {
    const tokens = { BOARD_ACCESS_TOKEN: randomBytes(32).toString("hex"), BOARD_BRIDGE_TOKEN: randomBytes(32).toString("hex"), BOARD_SESSION_SECRET: randomBytes(32).toString("hex") };
    assertE2eTarget({ convexUrl, root, marker });
    execFileSync(convexBin, ["env", "set", "BOARD_ACCESS_TOKEN", tokens.BOARD_ACCESS_TOKEN], { cwd: project, env: convexEnv, stdio: ["ignore", "pipe", "pipe"] });
    // The functions are pushed; run the backend ourselves (loopback only) instead of `convex dev` in watch mode.
    const backend = localBackendCommand(project);
    start("convex", backend.command, backend.args, { cwd: project, env: convexEnv, logDir });
    await waitFor(`${convexUrl}/version`);

    const webPort = await freePort(3150);
    const bridgePort = await freePort(3350);
    const appEnv = {
      ...env,
      ...tokens,
      NODE_ENV: "production",
      CONVEX_DEPLOYMENT: projectEnv.CONVEX_DEPLOYMENT,
      NEXT_PUBLIC_CONVEX_URL: convexUrl,
      BOARD_WEB_PORT: String(webPort),
      BOARD_BRIDGE_PORT: String(bridgePort),
      BRIDGE_PORT: String(bridgePort),
      BOARD_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
      BRIDGE_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort}`,
      NEXT_PUBLIC_STRATEGY_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
      SIGNAL_ROOM_BOARD_HOME: home,
      YTOS_ROOT: ytos,
      BOARD_ENGINE_FAKE: "1",
      BOARD_YTDLP_FAKE: "1",
      BOARD_ENGINES_ENABLED: "claude,codex,command-code",
      BOARD_BUILD_ID: "e2e",
    };
    if (!process.argv.includes("--no-build")) {
      console.log("next build …");
      execFileSync(path.join(REPO_ROOT, "node_modules", ".bin", "next"), ["build"], { cwd: REPO_ROOT, env: { ...appEnv, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 });
    }
    start("web", path.join(REPO_ROOT, "node_modules", ".bin", "next"), ["start", "-H", "127.0.0.1", "-p", String(webPort)], { cwd: REPO_ROOT, env: appEnv, logDir });
    start("bridge", process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "bridge/server.mjs"], { cwd: REPO_ROOT, env: appEnv, logDir });
    await waitFor(`http://127.0.0.1:${webPort}/board`);
    await waitFor(`http://127.0.0.1:${bridgePort}/health`);

    const args = process.argv.slice(2).filter((arg) => arg !== "--no-build" && arg !== "--keep");
    const result = spawn(path.join(REPO_ROOT, "node_modules", ".bin", "playwright"), ["test", "-c", "tests/e2e/playwright.config.ts", ...args], {
      cwd: REPO_ROOT,
      env: { ...appEnv, NODE_ENV: "test", BOARD_E2E_BASE_URL: `http://127.0.0.1:${webPort}`, BOARD_E2E_ROOT: root, BOARD_E2E_MARKER: marker, BOARD_E2E_CONVEX_URL: convexUrl, BOARD_E2E_PROJECT: project },
      stdio: "inherit",
    });
    exitCode = await new Promise((resolve) => result.on("exit", (code) => resolve(code ?? 1)));
  } finally {
    stopAll(convexPort);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (process.argv.includes("--keep")) console.log(`Behalten: ${root}`);
    else {
      assertE2eTarget({ convexUrl, root, marker });
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  process.exit(exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    stopAll();
    process.exit(1);
  });
}
