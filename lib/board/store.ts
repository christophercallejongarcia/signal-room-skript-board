import type { BoardEdge, BoardNode, Op, OpResult } from "./ops.ts";
import { boardConvex } from "./server.ts";

/**
 * The board's own storage adapter (ADR-0007): typed calls into the board's
 * Convex functions. The Signal Room `StorageAdapter` stays untouched.
 */

export type BoardSummary = { id: string; title: string; videoSlug?: string; revision: number; createdAt: number; lastOpenedAt: number };
export type BoardMeta = {
  id: string;
  title: string;
  videoSlug?: string;
  brandVoiceText: string;
  revision: number;
  nodeCount: number;
  restoreEpoch: number;
  mode: string;
  lease: { sessionId: string; generation: number; expiresAt: number } | null;
};
export type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };
export type LeaseResult =
  | { granted: true; generation: number; expiresAt: number; restoreEpoch: number; revision: number; takeover: boolean }
  | { granted: false; holderExpiresAt: number; revision: number };

type StoredNode = BoardNode & { _id: string; _creationTime: number; boardId: string; createdAt: number; updatedAt: number; deletedByOp?: string };
type StoredEdge = BoardEdge & { _id: string; _creationTime: number; boardId: string; createdAt: number };

function toNode(stored: StoredNode): BoardNode {
  const { _id, _creationTime, boardId, createdAt, updatedAt, deletedAt, deletedByOp, ...node } = stored;
  return node;
}

function toEdge(stored: StoredEdge): BoardEdge {
  return { id: stored.id, source: stored.source, target: stored.target, sourceHandle: stored.sourceHandle, targetHandle: stored.targetHandle, type: stored.type };
}

export function boardStore() {
  const convex = boardConvex();
  return {
    listBoards: () => convex.query<BoardSummary[]>("boards:list", { limit: 500 }),
    createBoard: (args: { opsVersion: number; id: string; title: string }) => convex.mutation<{ id: string; created: boolean }>("boards:create", args),
    renameBoard: (args: { opsVersion: number; boardId: string; title: string }) => convex.mutation<{ id: string; title: string; revision: number }>("boards:rename", args),
    removeBoard: (args: { opsVersion: number; boardId: string }) => convex.mutation<null>("boards:remove", args),
    getBoard: (boardId: string) => convex.query<BoardMeta>("boardLoad:getBoard", { boardId }),
    async listNodes(boardId: string, cursor: string | null): Promise<Page<BoardNode>> {
      const page = await convex.query<Page<StoredNode>>("boardLoad:listNodes", { boardId, paginationOpts: { numItems: 200, cursor } });
      return { ...page, page: page.page.map(toNode) };
    },
    async listEdges(boardId: string, cursor: string | null): Promise<Page<BoardEdge>> {
      const page = await convex.query<Page<StoredEdge>>("boardLoad:listEdges", { boardId, paginationOpts: { numItems: 200, cursor } });
      return { ...page, page: page.page.map(toEdge) };
    },
    getTexts: (boardId: string, nodeIds: string[]) => convex.query<{ texts: { nodeId: string; blocks: string; rev: number }[]; pending: string[] }>("boardLoad:getTexts", { boardId, nodeIds }),
    applyOps: (args: { opsVersion: number; restoreEpoch: number; boardId: string; sessionId: string; leaseGeneration: number; oldestUnconfirmedAt?: number; ops: Op[] }) =>
      convex.mutation<{ revision: number; results: OpResult[] }>("boardOps:applyOps", args),
    acquireLease: (args: { opsVersion: number; boardId: string; sessionId: string; takeover: boolean }) => convex.mutation<LeaseResult>("boardLease:acquire", args),
    heartbeat: (args: { boardId: string; sessionId: string; generation: number; oldestUnconfirmedAt?: number }) =>
      convex.mutation<{ ok: boolean; expiresAt: number; revision: number; generation: number }>("boardLease:heartbeat", args),
    releaseLease: (args: { boardId: string; sessionId: string; generation: number }) => convex.mutation<null>("boardLease:release", args),
  };
}
