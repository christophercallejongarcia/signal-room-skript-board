import { noStore, routeError } from "@/lib/board/http";
import { BoardApiError, boardConvex } from "@/lib/board/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** State of one run for a browser that follows it (retry, reload, other tab). */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const id = decodeURIComponent(runId);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw new BoardApiError(400, "invalid", "Ungültige runId.");
    const info = await boardConvex().query("boardChat:runInfo", { runId: id });
    if (!info) throw new BoardApiError(404, "not-found", "Lauf nicht gefunden.");
    return Response.json(info, { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}
