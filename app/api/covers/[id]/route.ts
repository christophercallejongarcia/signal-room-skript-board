import { NextResponse } from "next/server";
import { readCover } from "@/lib/adapters/storage/cover-cache";

export const runtime = "nodejs";

/** Serves a cached cover by external id. 404 when nothing is cached; the UI then shows the placeholder. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const cover = await readCover(id);
  if (!cover) return NextResponse.json({ error: "cover not cached" }, { status: 404 });
  return new Response(new Uint8Array(cover.bytes), {
    headers: {
      "content-type": cover.type,
      "cache-control": "public, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
