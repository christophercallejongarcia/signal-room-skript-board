import { parseSendBody, sendChat } from "@/lib/board/chat-run";
import { readJsonBody, routeError } from "@/lib/board/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** Send a chat message (PLAN.md point 81). The answer streams as a UI message stream (AI SDK v7). */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, 512 * 1024);
    return await sendChat(parseSendBody(body));
  } catch (error) {
    return routeError(error);
  }
}
