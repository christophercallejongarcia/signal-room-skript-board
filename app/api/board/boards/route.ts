import { newBoardId, newBoardTitle } from "@/lib/board/ids";
import { boardConvex, boardJsonError } from "@/lib/board/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const boards = await boardConvex().query("boards:list", { limit: 500 });
    return Response.json({ boards }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return boardJsonError(error);
  }
}

/** Create a board. The client sends its opsVersion; an older page gets 409 "Board neu laden". */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { opsVersion?: unknown; id?: unknown; title?: unknown };
  if (typeof body.opsVersion !== "number") return Response.json({ error: "opsVersion fehlt." }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : newBoardId();
  const title = typeof body.title === "string" && body.title.trim() ? body.title : newBoardTitle();
  try {
    const result = await boardConvex().mutation<{ id: string; created: boolean }>("boards:create", { opsVersion: body.opsVersion, id, title });
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return boardJsonError(error);
  }
}
