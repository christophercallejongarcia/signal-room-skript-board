"use client";

import { OPS_VERSION } from "./versions.ts";

/**
 * Browser side of the board API: every request carries the CSRF header derived
 * from the session (point 11). Errors come back as `BoardClientError` with the
 * server's German message.
 */
export class BoardClientError extends Error {
  status: number;
  kind: string;
  data: Record<string, unknown>;
  constructor(status: number, kind: string, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.data = data;
  }
}

export function csrfToken(): string {
  const match = document.cookie.split("; ").find((part) => part.startsWith("board_csrf="));
  return match ? decodeURIComponent(match.slice("board_csrf=".length)) : "";
}

export async function boardApi<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; keepalive?: boolean } = {}): Promise<T> {
  const method = init.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`/api/board${path}`, {
      method,
      headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { "x-board-csrf": csrfToken() } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      keepalive: init.keepalive,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (error) {
    throw new BoardClientError(0, "offline", error instanceof Error && error.name === "AbortError" ? "Abgebrochen." : "Keine Verbindung zum Board-Server.");
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new BoardClientError(response.status, typeof data.kind === "string" ? data.kind : "error", typeof data.error === "string" ? data.error : `HTTP ${response.status}`, data);
  return data as T;
}

export { OPS_VERSION };
