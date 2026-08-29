import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { withCoverUrls } from "@/lib/adapters/storage/cover-cache";
import { parseSignalMark, type SignalMark } from "@/lib/signal-mark";

export const runtime = "nodejs";

export async function GET() {
  const storage = getStorage();
  const [creators, signals] = await Promise.all([storage.listCreators(), storage.listSignals()]);
  return NextResponse.json({ creators, signals: await withCoverUrls(signals) });
}

/** Saves a signal for the Saved view, or releases it. The mark lives on the signal and survives every refresh. */
export async function PATCH(request: Request) {
  // parseSignalMark bounds and rejects the body; it is the only place that decides what a PATCH mark is.
  let mark: SignalMark;
  try {
    mark = parseSignalMark(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const signal = await getStorage().markSignal(mark.id, mark.saved ? new Date().toISOString() : null);
  if (!signal) return NextResponse.json({ error: `unknown signal ${mark.id}` }, { status: 404 });
  const [withCover] = await withCoverUrls([signal]);
  return NextResponse.json({ signal: withCover });
}
