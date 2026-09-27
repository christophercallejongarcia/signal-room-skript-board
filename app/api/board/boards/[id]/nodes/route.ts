import { boardIdFrom, noStore, routeError } from "@/lib/board/http";
import { boardStore } from "@/lib/board/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One page of 200 live nodes (point 23). Follow `continueCursor` until `isDone`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const cursor = new URL(request.url).searchParams.get("cursor");
    return Response.json(await boardStore().listNodes(await boardIdFrom(params), cursor || null), { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}
