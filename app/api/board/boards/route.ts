import { readJsonBody, noStore, routeError } from "@/lib/board/http";
import { newBoardId, newBoardTitle } from "@/lib/board/ids";
import { boardStore } from "@/lib/board/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ boards: await boardStore().listBoards() }, { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}

/** Create a board with a German random name (point 56). An older page gets 409 "Board neu laden". */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (typeof body.opsVersion !== "number") return Response.json({ error: "opsVersion fehlt." }, { status: 400 });
    const id = typeof body.id === "string" ? body.id : newBoardId();
    const title = typeof body.title === "string" && body.title.trim() ? body.title : newBoardTitle();
    const result = await boardStore().createBoard({ opsVersion: body.opsVersion, id, title });
    return Response.json({ ...result, title }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return routeError(error);
  }
}
