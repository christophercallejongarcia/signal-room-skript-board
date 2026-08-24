import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { withCoverUrls } from "@/lib/adapters/storage/cover-cache";

export const runtime = "nodejs";

export async function GET() {
  const storage = getStorage();
  const [creators, signals] = await Promise.all([storage.listCreators(), storage.listSignals()]);
  return NextResponse.json({ creators, signals: await withCoverUrls(signals) });
}
