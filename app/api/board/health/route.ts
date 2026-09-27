import { boardConvex, bridgeFetch, toBoardApiError, webInstance } from "@/lib/board/server";
import { buildId, OPS_VERSION, PROTOCOL_VERSION, SUPPORTED_OPS_VERSIONS, SUPPORTED_PROTOCOL_VERSIONS } from "@/lib/board/versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Layer = { ok: boolean; error?: string; [key: string]: unknown };

/** Health contract over all three layers (PLAN.md points 9b, 53, 54). */
export async function GET() {
  const instance = webInstance();
  const web: Layer = {
    ok: true,
    layer: "web",
    instanceId: instance.instanceId,
    build: buildId(),
    deployment: process.env.CONVEX_DEPLOYMENT ?? null,
    protocolVersion: PROTOCOL_VERSION,
    opsVersion: OPS_VERSION,
    supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    supportedOpsVersions: SUPPORTED_OPS_VERSIONS,
  };

  const [convex, bridge]: [Layer, Layer] = await Promise.all([
    boardConvex()
      .query<Layer>("board:boardHealth")
      .catch((error: unknown) => ({ ok: false, layer: "convex", error: toBoardApiError(error).message })),
    bridgeFetch("/v1/board/health", { timeoutMs: 3_000 })
      .then(async (response) => (response.ok ? ((await response.json()) as Layer) : { ok: false, layer: "bridge", error: `HTTP ${response.status}` }))
      .catch((error: unknown) => ({ ok: false, layer: "bridge", error: `Bridge nicht erreichbar (${error instanceof Error ? error.message : String(error)}). \`npm run dev:board\` starten.` })),
  ]);

  const versionsMatch =
    Boolean(convex.ok) &&
    Boolean(bridge.ok) &&
    (convex.supportedOpsVersions as number[] | undefined)?.includes(OPS_VERSION) === true &&
    (bridge.supportedProtocolVersions as number[] | undefined)?.includes(PROTOCOL_VERSION) === true;
  const ok = web.ok && convex.ok && bridge.ok && versionsMatch;
  return Response.json({ ok, versionsMatch, layers: { web, convex, bridge } }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
