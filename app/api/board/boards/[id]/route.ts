import { boardIdFrom, noStore, readJsonBody, requireNumber, requireString, routeError } from "@/lib/board/http";
import { boardStore } from "@/lib/board/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    return Response.json(await boardStore().getBoard(await boardIdFrom(params)), { headers: noStore });
  } catch (error) {
    return routeError(error);
  }
}

/** Rename from the list (last write wins). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const boardId = await boardIdFrom(params);
    const body = await readJsonBody(request);
    return Response.json(await boardStore().renameBoard({ opsVersion: requireNumber(body.opsVersion, "opsVersion"), boardId, title: requireString(body.title, "title") }));
  } catch (error) {
    return routeError(error);
  }
}

/** Soft delete. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const boardId = await boardIdFrom(params);
    const body = await readJsonBody(request);
    await boardStore().removeBoard({ opsVersion: requireNumber(body.opsVersion, "opsVersion"), boardId });
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
