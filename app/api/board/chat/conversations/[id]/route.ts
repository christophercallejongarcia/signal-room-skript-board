import { noStore, readJsonBody, requireString, routeError } from "@/lib/board/http";
import { boardConvex } from "@/lib/board/server";
import { OPS_VERSION } from "@/lib/board/versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rename a conversation. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readJsonBody(request, 8 * 1024);
    await boardConvex().mutation("boardChat:renameConversation", {
      opsVersion: OPS_VERSION,
      restoreEpoch: typeof body.restoreEpoch === "number" ? body.restoreEpoch : 1,
      boardId: requireString(body.boardId, "boardId"),
      conversationId: decodeURIComponent(id),
      title: requireString(body.title, "title"),
    });
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}

/** Delete a conversation (soft delete, after the confirmation in the UI). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const search = new URL(request.url).searchParams;
    await boardConvex().mutation("boardChat:deleteConversation", {
      opsVersion: OPS_VERSION,
      restoreEpoch: Number(search.get("restoreEpoch") ?? 1),
      boardId: requireString(search.get("boardId"), "boardId"),
      conversationId: decodeURIComponent(id),
    });
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}
