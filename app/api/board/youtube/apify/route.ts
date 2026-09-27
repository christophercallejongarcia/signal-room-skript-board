import { apifyEnabled, apifyMaxUsd, startApify } from "@/lib/board/apify";
import { noStore, readJsonBody, routeError } from "@/lib/board/http";
import { BoardApiError } from "@/lib/board/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ enabled: apifyEnabled(), maxUsd: apifyMaxUsd() }, { headers: noStore });
}

/** "Transkript über Apify holen (höchstens 0,05 $)" (point 70). The click's requestId makes it idempotent. */
export async function POST(request: Request) {
  try {
    if (!apifyEnabled()) throw new BoardApiError(503, "apify-off", "Apify ist nicht eingerichtet (APIFY_TOKEN fehlt).");
    const body = await readJsonBody(request, 4 * 1024);
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new BoardApiError(400, "invalid", "videoId oder requestId fehlt.");
    return Response.json(await startApify(videoId, requestId));
  } catch (error) {
    return routeError(error);
  }
}
