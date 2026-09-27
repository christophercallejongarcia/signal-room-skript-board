import { noStore, routeError } from "@/lib/board/http";
import { BoardApiError, boardConvex } from "@/lib/board/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full active transcript of a video, for "Transkript kopieren" (point 71). */
export async function GET(request: Request) {
  try {
    const videoId = new URL(request.url).searchParams.get("videoId") ?? "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new BoardApiError(400, "invalid", "Ungültige Video-ID.");
    const transcript = await boardConvex().query<{ versionId: string; text: string } | null>("boardYoutube:getTranscript", { videoId });
    if (!transcript) throw new BoardApiError(404, "not-found", "Noch kein Transkript.");
    return Response.json(transcript, { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}
