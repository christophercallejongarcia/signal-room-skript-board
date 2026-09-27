import { noStore, routeError } from "@/lib/board/http";
import { BoardApiError, bridgeFetch } from "@/lib/board/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Engines, models, budgets and their state for the model dropdown (PLAN.md point 77). */
export async function GET(request: Request) {
  try {
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const response = await bridgeFetch(`/v1/board/engines${fresh ? "?fresh=1" : ""}`, { timeoutMs: 30_000 }).catch(() => null);
    if (!response?.ok) throw new BoardApiError(502, "bridge-unreachable", "Bridge nicht erreichbar. `npm run dev:board` starten.");
    return Response.json(await response.json(), { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}
