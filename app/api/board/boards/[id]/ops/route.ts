import { boardIdFrom, readJsonBody, requireNumber, requireString, routeError } from "@/lib/board/http";
import { validateOps } from "@/lib/board/ops";
import { boardStore } from "@/lib/board/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Op queue endpoint (point 25): applied | duplicate | conflict per op plus the new board revision. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const boardId = await boardIdFrom(params);
    const body = await readJsonBody(request);
    const ops = validateOps(body.ops);
    const result = await boardStore().applyOps({
      opsVersion: requireNumber(body.opsVersion, "opsVersion"),
      restoreEpoch: requireNumber(body.restoreEpoch, "restoreEpoch"),
      boardId,
      sessionId: requireString(body.sessionId, "sessionId", /^[A-Za-z0-9_-]{8,80}$/),
      leaseGeneration: requireNumber(body.leaseGeneration, "leaseGeneration"),
      ...(typeof body.oldestUnconfirmedAt === "number" ? { oldestUnconfirmedAt: body.oldestUnconfirmedAt } : {}),
      ops,
    });
    return Response.json(result);
  } catch (error) {
    return routeError(error);
  }
}
