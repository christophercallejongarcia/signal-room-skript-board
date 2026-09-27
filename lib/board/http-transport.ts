"use client";

import type { BoardTransport } from "./board-session.ts";
import { BoardClientError, boardApi } from "./client.ts";
import type { TransportError } from "./op-queue.ts";

/** BoardTransport over the Next routes. Maps HTTP errors to what the op queue understands. */
function toTransportError(error: unknown): TransportError {
  if (error instanceof BoardClientError) {
    if (error.status === 0) return { kind: "offline", message: error.message };
    if (error.status >= 500 && error.kind !== "config") return { kind: "server", status: error.status, message: error.message };
    return { kind: "fatal", status: error.status, errorKind: error.kind, message: error.message };
  }
  return { kind: "offline", message: error instanceof Error ? error.message : String(error) };
}

export function httpTransport(boardId: string): BoardTransport {
  const base = `/boards/${encodeURIComponent(boardId)}`;
  return {
    getBoard: () => boardApi(base),
    listNodes: (_id, cursor) => boardApi(`${base}/nodes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    listEdges: (_id, cursor) => boardApi(`${base}/edges${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    getTexts: (_id, nodeIds) => boardApi(`${base}/texts`, { method: "POST", body: { nodeIds } }),
    async applyOps(body) {
      try {
        return await boardApi(`${base}/ops`, { method: "POST", body });
      } catch (error) {
        throw toTransportError(error);
      }
    },
    acquireLease: (body) => boardApi(`${base}/lease`, { method: "POST", body: { action: "acquire", ...body } }),
    heartbeat: (body) => boardApi(`${base}/lease`, { method: "POST", body: { action: "heartbeat", ...body } }),
    releaseLease(body) {
      void boardApi(`${base}/lease`, { method: "POST", body: { action: "release", ...body }, keepalive: true }).catch(() => {});
    },
  };
}
