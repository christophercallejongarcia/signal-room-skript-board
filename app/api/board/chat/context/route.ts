import { contextPreview } from "@/lib/board/chat-run";
import { noStore, routeError } from "@/lib/board/http";
import { isEngineId } from "@/lib/board/models";
import { BoardApiError } from "@/lib/board/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Context display of the chat node: sources, bytes and estimate against the model's budget (PLAN.md point 42). */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const engine = params.get("engine");
    if (!isEngineId(engine)) throw new BoardApiError(400, "invalid", "Unbekannte Engine.");
    const preview = await contextPreview({
      boardId: params.get("boardId") ?? "",
      chatNodeId: params.get("chatNodeId") ?? "",
      engine,
      modelId: params.get("modelId") ?? "",
      brandVoice: params.get("brandVoice") === "chris" ? "chris" : "none",
    });
    return Response.json(preview, { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}
