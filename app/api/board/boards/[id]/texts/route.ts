import { BoardApiError } from "@/lib/board/server";
import { boardIdFrom, noStore, readJsonBody, routeError } from "@/lib/board/http";
import { isNodeId } from "@/lib/board/ids";
import { boardStore } from "@/lib/board/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Editor data for text nodes, at most 8 MB per answer; the rest comes back as `pending`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const boardId = await boardIdFrom(params);
    const body = await readJsonBody(request, 64 * 1024);
    const nodeIds = body.nodeIds;
    if (!Array.isArray(nodeIds) || nodeIds.length > 500 || !nodeIds.every(isNodeId)) throw new BoardApiError(400, "invalid", "nodeIds fehlen oder sind ungültig.");
    return Response.json(await boardStore().getTexts(boardId, nodeIds), { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}
