import { randomBytes, timingSafeEqual } from "node:crypto";
import { logEvent } from "../../lib/board/eventlog.mjs";
import { tryLock } from "../../lib/board/oslock.mjs";
import { boardFile } from "../../lib/board/paths.mjs";
import { startSweeper } from "../engines/cleanup.mjs";
import { chatRoutes } from "./chat.mjs";
import { youtubeRoute } from "./youtube.mjs";
import { buildId, OPS_VERSION, PROTOCOL_VERSION, SUPPORTED_OPS_VERSIONS, SUPPORTED_PROTOCOL_VERSIONS } from "../../lib/board/versions.ts";

/**
 * All `/v1/board/*` routes of the bridge (PLAN.md points 12, 38a, 53). The
 * existing bridge routes and their 128 KB limit stay untouched; `server.mjs`
 * only dispatches here before its own route map.
 */
export const BOARD_PREFIX = "/v1/board/";
export const TOKEN_HEADER = "x-board-bridge-token";

/** One live bridge instance, proven by a kernel lock it holds until the process ends. */
export function createBridgeInstance() {
  const instanceId = `bridge-${randomBytes(6).toString("hex")}`;
  const lockFile = boardFile("bridges", `${instanceId}.lock`);
  const lock = tryLock(lockFile);
  if (!lock) throw new Error(`Instanz-Sperre ${lockFile} ist belegt.`);
  lock.writeOwner({ instanceId, pid: process.pid, startedAt: new Date().toISOString() });
  return { instanceId, lockFile, lock, startedAt: Date.now() };
}

export function tokenMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || expected.length < 32) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

export function boardBodyLimit(env = process.env) {
  const value = Number.parseInt(env.BOARD_BRIDGE_MAX_BODY_BYTES || "", 10);
  return Number.isFinite(value) && value > 0 ? value : 4 * 1024 * 1024;
}

export async function readBoardJson(request, limit = boardBodyLimit()) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Anfrage ist zu groß."), { status: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) throw Object.assign(new Error("Anfrage ohne Inhalt."), { status: 400 });
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Anfrage ist kein gültiges JSON."), { status: 400 });
  }
}

/**
 * Build the board request handler. `routes` maps "METHOD /path" to
 * `async ({ request, response, url, params }) => void`. Built in: health,
 * YouTube ingest, chat, abort, runs, engines and drain.
 */
export function createBoardHandler({ instance, env = process.env, extraRoutes = [], sweep = true } = {}) {
  const expectedToken = env.BOARD_BRIDGE_TOKEN;
  const youtube = youtubeRoute({ instance, readJson: readBoardJson });
  const chat = chatRoutes({ instance, readJson: readBoardJson, bodyLimit: () => boardBodyLimit(env), env });
  // Clean up after dead bridges now and every 30 s (points 39, 39c).
  if (sweep) startSweeper({ selfInstanceId: instance.instanceId });
  const routes = [
    {
      method: "GET",
      pattern: /^\/v1\/board\/health$/,
      handle: ({ response }) =>
        send(response, 200, {
          ok: true,
          layer: "bridge",
          instanceId: instance.instanceId,
          pid: process.pid,
          build: buildId(env),
          uptimeMs: Date.now() - instance.startedAt,
          protocolVersion: PROTOCOL_VERSION,
          opsVersion: OPS_VERSION,
          supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
          supportedOpsVersions: SUPPORTED_OPS_VERSIONS,
        }),
    },
    youtube.route,
    ...chat.routes,
    ...extraRoutes,
  ];

  return async function handleBoard(request, response, url) {
    const started = Date.now();
    if (!tokenMatches(request.headers[TOKEN_HEADER], expectedToken)) {
      logEvent({ instanceId: instance.instanceId, layer: "bridge", phase: url.pathname, code: "unauthorized", status: 401 });
      return send(response, 401, { error: "Bridge-Token fehlt oder ist falsch." });
    }
    for (const route of routes) {
      if (route.method !== request.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      try {
        await route.handle({ request, response, url, params: match.slice(1), send: (status, payload, headers) => send(response, status, payload, headers) });
      } catch (error) {
        const status = error?.status ?? 500;
        logEvent({ instanceId: instance.instanceId, layer: "bridge", phase: url.pathname, code: error?.code ?? "error", status, durationMs: Date.now() - started });
        if (!response.headersSent) send(response, status, { error: status === 500 ? "Interner Fehler der Bridge." : error.message });
        else response.end();
      }
      return;
    }
    return send(response, 404, { error: "Unbekannte Board-Route." });
  };
}
