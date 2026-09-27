import { noStore, routeError } from "@/lib/board/http";
import { boardConvex } from "@/lib/board/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The last 50 messages of a conversation, "Ältere laden" through `before` (PLAN.md point 23). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const before = new URL(request.url).searchParams.get("before");
    const result = await boardConvex().query("boardChat:listMessages", { conversationId: decodeURIComponent(id), ...(before ? { before: Number(before) } : {}) });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}
