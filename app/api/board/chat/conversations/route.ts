import { noStore, routeError } from "@/lib/board/http";
import { BoardApiError, boardConvex } from "@/lib/board/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Conversations of one chat node, newest first (PLAN.md point 80). */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const boardId = params.get("boardId") ?? "";
    const chatNodeId = params.get("chatNodeId") ?? "";
    if (!boardId || !chatNodeId) throw new BoardApiError(400, "invalid", "boardId und chatNodeId fehlen.");
    const conversations = await boardConvex().query("boardChat:listConversations", { boardId, chatNodeId });
    return Response.json({ conversations }, { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}
