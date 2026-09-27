import { ConvexHttpClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { randomBytes } from "node:crypto";

/**
 * Server-side access from Next route handlers to Convex and the bridge for the
 * board (ADR-0007). Only this module knows BOARD_ACCESS_TOKEN and BOARD_BRIDGE_TOKEN;
 * the browser never sees either.
 */

export class BoardApiError extends Error {
  status: number;
  kind: string;
  details: Record<string, unknown>;
  constructor(status: number, kind: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.details = details;
  }
}

const KIND_STATUS: Record<string, number> = {
  unauthorized: 500,
  version: 409,
  readonly: 423,
  draining: 423,
  restoring: 423,
  epoch: 409,
  "not-found": 404,
  conflict: 409,
  lease: 409,
  invalid: 400,
  "too-large": 413,
};

/** Map a thrown Convex error to a BoardApiError; unknown errors become 502 (store unreachable). */
export function toBoardApiError(error: unknown): BoardApiError {
  if (error instanceof BoardApiError) return error;
  if (error instanceof ConvexError && error.data && typeof error.data === "object") {
    const data = error.data as Record<string, unknown>;
    const kind = typeof data.kind === "string" ? data.kind : "error";
    const message = typeof data.message === "string" ? data.message : "Board-Fehler.";
    // A wrong or missing token is a server misconfiguration, not the user's fault.
    if (kind === "unauthorized") return new BoardApiError(500, kind, "Board ist falsch konfiguriert (BOARD_ACCESS_TOKEN).");
    const { kind: _kind, message: _message, ...details } = data;
    return new BoardApiError(KIND_STATUS[kind] ?? 409, kind, message, details);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new BoardApiError(502, "unavailable", `Convex ist nicht erreichbar: ${message.slice(0, 200)}`);
}

export function boardJsonError(error: unknown): Response {
  const apiError = toBoardApiError(error);
  return Response.json({ error: apiError.message, kind: apiError.kind, ...apiError.details }, { status: apiError.status, headers: { "cache-control": "no-store" } });
}

function requireEnv(name: string, minLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minLength) throw new BoardApiError(503, "config", `${name} fehlt. Board mit \`npm run dev:board\` starten.`);
  return value;
}

export function convexUrl(): string {
  return requireEnv("NEXT_PUBLIC_CONVEX_URL");
}

/** A Convex caller that adds the board token to every call. */
export function boardConvex() {
  const client = new ConvexHttpClient(convexUrl());
  const token = requireEnv("BOARD_ACCESS_TOKEN", 32);
  return {
    async query<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      try {
        return (await client.query(ref(name) as FunctionReference<"query">, { token, ...args })) as T;
      } catch (error) {
        throw toBoardApiError(error);
      }
    },
    async mutation<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      try {
        return (await client.mutation(ref(name) as FunctionReference<"mutation">, { token, ...args })) as T;
      } catch (error) {
        throw toBoardApiError(error);
      }
    },
  };
}

function ref(name: string) {
  const [module, fn] = name.split(":");
  return (anyApi as Record<string, Record<string, unknown>>)[module][fn];
}

export function bridgeUrl(): string {
  const port = process.env.BOARD_BRIDGE_PORT?.trim();
  return process.env.BOARD_BRIDGE_URL?.trim() || (port ? `http://127.0.0.1:${port}` : "http://127.0.0.1:3311");
}

/** fetch against the bridge's `/v1/board/*` with the bridge token. */
export async function bridgeFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const token = requireEnv("BOARD_BRIDGE_TOKEN", 32);
  const { timeoutMs = 10_000, headers, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(`${bridgeUrl()}${path}`, {
    ...rest,
    headers: { ...(headers as Record<string, string>), "x-board-bridge-token": token },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  });
}

type WebInstance = { instanceId: string; startedAt: number };
const globalForBoard = globalThis as typeof globalThis & { __boardWebInstance?: WebInstance };

/** Identity of this Next process, stable across requests and hot reloads. */
export function webInstance(): WebInstance {
  globalForBoard.__boardWebInstance ??= { instanceId: `next-${randomBytes(6).toString("hex")}`, startedAt: Date.now() };
  return globalForBoard.__boardWebInstance;
}
