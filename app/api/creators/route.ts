import { NextResponse } from "next/server";
import type { Creator, Network } from "@/lib/contracts";
import { normalizeHandle, resolveProfile } from "@/lib/adapters/sources/apify-instagram";
import { getStorage } from "@/lib/adapters/storage";
import { runBackfill } from "@/lib/collect";

export const runtime = "nodejs";
export const maxDuration = 300;

const ACCENTS = ["#b9ff5c", "#ff6546", "#5cc8ff", "#ffd75c", "#c77dff"];

export async function GET() {
  return NextResponse.json({ creators: await getStorage().listCreators() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { handle?: string; network?: Network };
  const network = body.network ?? "instagram";
  if (network !== "instagram") {
    return NextResponse.json({ error: `Network ${network} has no connector yet` }, { status: 400 });
  }
  const handle = normalizeHandle(body.handle ?? "");
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

  const storage = getStorage();
  const id = `${network}-${handle}`;
  const existing = (await storage.listCreators()).find((c) => c.id === id);
  if (existing) return NextResponse.json({ creator: existing, existing: true, recordsAdded: 0 });

  try {
    const profile = await resolveProfile(handle);
    const creator: Creator = {
      id,
      name: profile.name,
      handle: `@${profile.handle}`,
      network,
      audience: profile.followers,
      accent: ACCENTS[handle.length % ACCENTS.length],
      avatarUrl: profile.avatarUrl,
      url: profile.url,
    };
    const { recordsAdded, covers } = await runBackfill(creator);
    return NextResponse.json({ creator, existing: false, recordsAdded, covers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
