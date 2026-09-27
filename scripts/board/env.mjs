import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Minimal `.env` parser: KEY=VALUE per line, `#` comments, optional quotes. No expansion. */
export function parseEnvFile(text) {
  const values = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

/** `.env.local` of this checkout, loaded explicitly (plan point 46). Process env wins. */
export function loadBoardEnv(root = REPO_ROOT) {
  const file = path.join(root, ".env.local");
  const fromFile = fs.existsSync(file) ? parseEnvFile(fs.readFileSync(file, "utf8")) : {};
  return { ...fromFile, ...process.env };
}

/**
 * Board development never talks to the shared cloud deployment (plan point 8).
 * Every script that runs the Convex CLI calls this first.
 */
export function assertLocalConvex(env) {
  const deployment = env.CONVEX_DEPLOYMENT || "";
  const url = env.NEXT_PUBLIC_CONVEX_URL || "";
  if (!/^(local|anonymous):/.test(deployment)) {
    throw new Error(
      `CONVEX_DEPLOYMENT ist "${deployment || "leer"}". Das Board läuft nur gegen eine lokale Deployment (local: oder anonymous:). Abbruch, damit nichts ins Cloud-Deployment geht.`,
    );
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url)) {
    throw new Error(`NEXT_PUBLIC_CONVEX_URL zeigt nicht auf 127.0.0.1. Abbruch.`);
  }
  if (env.CONVEX_DEPLOY_KEY) throw new Error("CONVEX_DEPLOY_KEY ist gesetzt. Abbruch, damit kein Deploy in die Cloud möglich ist.");
}

/** Ports of the local Convex backend from `.convex/local/default/config.json`. */
export function localConvexPorts(root = REPO_ROOT) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, ".convex", "local", "default", "config.json"), "utf8"));
    return [config.ports?.cloud, config.ports?.site].filter((port) => Number.isInteger(port));
  } catch {
    return [];
  }
}

export function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/** Run the Convex CLI against the local deployment only. Returns stdout. */
export function convexCli(args, env, { input } = {}) {
  assertLocalConvex(env);
  return execFileSync(path.join(REPO_ROOT, "node_modules", ".bin", "convex"), args, {
    cwd: REPO_ROOT,
    env: { ...env, CONVEX_AGENT_MODE: "anonymous" },
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });
}

export function spawnConvexDev(env, options = {}) {
  assertLocalConvex(env);
  return spawn(path.join(REPO_ROOT, "node_modules", ".bin", "convex"), ["dev", "--typecheck", "disable", "--tail-logs", "disable"], {
    cwd: REPO_ROOT,
    env: { ...env, CONVEX_AGENT_MODE: "anonymous" },
    ...options,
  });
}
