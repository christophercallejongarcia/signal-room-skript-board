import { stopRun } from "@/lib/board/chat-run";
import { noStore, routeError } from "@/lib/board/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stop button (PLAN.md points 34, 85). */
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    return Response.json(await stopRun(decodeURIComponent(runId)), { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}
