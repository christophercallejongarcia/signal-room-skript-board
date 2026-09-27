import { isBoardId } from "./ids.ts";
import { OpValidationError } from "./ops.ts";
import { BoardApiError, boardJsonError } from "./server.ts";

/** Shared helpers for the board route handlers. */

export async function readJsonBody(request: Request, maxBytes = 5 * 1024 * 1024): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new BoardApiError(413, "too-large", "Anfrage ist zu groß.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new BoardApiError(413, "too-large", "Anfrage ist zu groß.");
  try {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new BoardApiError(400, "invalid", "Anfrage ist kein gültiges JSON.");
  }
}

export async function boardIdFrom(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const boardId = decodeURIComponent(id);
  if (!isBoardId(boardId)) throw new BoardApiError(400, "invalid", "Ungültige Board-ID.");
  return boardId;
}

export function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BoardApiError(400, "invalid", `${name} fehlt.`);
  return value;
}

export function requireString(value: unknown, name: string, pattern?: RegExp): string {
  if (typeof value !== "string" || (pattern && !pattern.test(value))) throw new BoardApiError(400, "invalid", `${name} fehlt oder ist ungültig.`);
  return value;
}

export function routeError(error: unknown): Response {
  if (error instanceof OpValidationError) return Response.json({ error: error.message, kind: "invalid" }, { status: 400 });
  return boardJsonError(error);
}

export const noStore = { "cache-control": "no-store" } as const;
