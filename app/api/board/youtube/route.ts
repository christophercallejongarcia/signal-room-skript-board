import { resumeApify } from "@/lib/board/apify";
import { noStore, readJsonBody, routeError } from "@/lib/board/http";
import { BoardApiError } from "@/lib/board/server";
import { ingestYoutube, sourcesFor } from "@/lib/board/youtube-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Status of the requested sources (the node polls this while a transcript is on its way). */
export async function GET(request: Request) {
  try {
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    if (ids.length > 500 || !ids.every((id) => VIDEO_ID.test(id))) throw new BoardApiError(400, "invalid", "Ungültige Video-IDs.");
    let sources = await sourcesFor(ids);
    const apify = sources.filter((source) => source.transcriptStatus === "apify-pending");
    if (apify.length > 0) {
      for (const source of apify) await resumeApify(source.videoId).catch(() => {});
      sources = await sourcesFor(ids);
    }
    return Response.json({ sources }, { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}

/** Start (or join) the ingest of one video; `retry` is the "Erneut versuchen" button. */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, 4 * 1024);
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!VIDEO_ID.test(videoId)) throw new BoardApiError(400, "invalid", "Ungültige Video-ID.");
    const outcome = await ingestYoutube(videoId, { retry: body.retry === true });
    const [source] = await sourcesFor([videoId]);
    const headers = outcome.retryAfter ? { "retry-after": String(outcome.retryAfter) } : undefined;
    return Response.json({ ...outcome, source }, { status: outcome.status === "queued" ? 429 : 200, headers });
  } catch (error) {
    return routeError(error);
  }
}
