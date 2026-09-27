import { boardIdFrom, readJsonBody, requireNumber, requireString, routeError } from "@/lib/board/http";
import { boardStore } from "@/lib/board/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Write lease (point 28): `acquire` (optionally as takeover), `heartbeat`, `release`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const boardId = await boardIdFrom(params);
    const body = await readJsonBody(request, 16 * 1024);
    const sessionId = requireString(body.sessionId, "sessionId", /^[A-Za-z0-9_-]{8,80}$/);
    const store = boardStore();
    if (body.action === "acquire") {
      return Response.json(await store.acquireLease({ opsVersion: requireNumber(body.opsVersion, "opsVersion"), boardId, sessionId, takeover: body.takeover === true }));
    }
    if (body.action === "heartbeat") {
      return Response.json(
        await store.heartbeat({ boardId, sessionId, generation: requireNumber(body.generation, "generation"), ...(typeof body.oldestUnconfirmedAt === "number" ? { oldestUnconfirmedAt: body.oldestUnconfirmedAt } : {}) }),
      );
    }
    if (body.action === "release") {
      await store.releaseLease({ boardId, sessionId, generation: requireNumber(body.generation, "generation") });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (error) {
    return routeError(error);
  }
}
