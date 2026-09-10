import { NextResponse } from "next/server";
import type { Creator, Network } from "@/lib/contracts";
import { normalizeHandle, resolveProfile } from "@/lib/adapters/sources/apify-instagram";
import { getStorage } from "@/lib/adapters/storage";
import { runBackfill } from "@/lib/collect";
import { parseCreatorMark, type CreatorMark } from "@/lib/creator-mark";

export const runtime = "nodejs";
export const maxDuration = 300;

const ACCENTS = ["#b9ff5c", "#ff6546", "#5cc8ff", "#ffd75c", "#c77dff"];

export async function GET() {
  return NextResponse.json({ creators: await getStorage().listCreators() });
}

/** Moves a creator between the views: owned sends them to Profile, foreign splits their Format Signals. */
export async function PATCH(request: Request) {
  // parseCreatorMark bounds and rejects the body; it is the only place that decides what a PATCH mark is.
  let mark: CreatorMark;
  try {
    mark = parseCreatorMark(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const storage = getStorage();
  const creator = (await storage.listCreators()).find((c) => c.id === mark.id);
  if (!creator) return NextResponse.json({ error: `unknown creator ${mark.id}` }, { status: 404 });

  // Only the marks the body carries move; the other one keeps its value.
  const updated: Creator = {
    ...creator,
    ...(mark.owned === undefined ? {} : { owned: mark.owned }),
    ...(mark.foreign === undefined ? {} : { foreign: mark.foreign }),
  };
  await storage.upsertCreator(updated);
  return NextResponse.json({ creator: updated });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { handle?: string; network?: Network; owned?: boolean; market?: string };
  const network = body.network ?? "instagram";
  if (network !== "instagram") {
    return NextResponse.json({ error: `Network ${network} has no connector yet` }, { status: 400 });
  }
  const handle = normalizeHandle(body.handle ?? "");
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
  const owned = body.owned === true;
  if (body.market !== undefined && body.market !== "de" && body.market !== "en") {
    return NextResponse.json({ error: `market must be "de" or "en"` }, { status: 400 });
  }
  // Missing market means "de" everywhere; only "en" is worth storing.
  const market = body.market === "en" ? ("en" as const) : undefined;

  const storage = getStorage();
  const id = `${network}-${handle}`;
  const existing = (await storage.listCreators()).find((c) => c.id === id);
  if (existing) {
    // Re-adding a tracked handle is a no-op, except for a ticked owned box: that still sets the
    // mark. An unticked box never clears it; unmarking is the toggle in Tracked Channels.
    if (!owned || existing.owned) return NextResponse.json({ creator: existing, existing: true, recordsAdded: 0 });
    const marked: Creator = { ...existing, owned: true };
    await storage.upsertCreator(marked);
    return NextResponse.json({ creator: marked, existing: true, recordsAdded: 0 });
  }

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
      // Set at add time, so the first backfill already lands in Profile instead of the feed.
      ...(owned ? { owned: true } : {}),
      ...(market ? { market } : {}),
    };
    const { recordsAdded, covers } = await runBackfill(creator);
    return NextResponse.json({ creator, existing: false, recordsAdded, covers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
