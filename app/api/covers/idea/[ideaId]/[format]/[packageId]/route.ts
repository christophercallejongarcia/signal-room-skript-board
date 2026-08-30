import { readGeneratedCover } from "@/lib/adapters/storage/cover-lab-cache";

export const runtime = "nodejs";

/** Serves a generated local Cover-Lab asset. IDs are validated before a path is built. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ ideaId: string; format: string; packageId: string }> },
) {
  const { ideaId, format, packageId } = await context.params;
  const cover = await readGeneratedCover(ideaId, format, packageId);
  if (!cover) return new Response("cover not found", { status: 404 });
  return new Response(new Uint8Array(cover.bytes), {
    headers: {
      "content-type": cover.type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
