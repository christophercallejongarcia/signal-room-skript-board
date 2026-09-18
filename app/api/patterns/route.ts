import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { discoverPattern, localPatternDiscoveryBridge, parsePatternDiscoveryRequest } from "@/lib/pattern-discovery-run";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ comparisons: await getStorage().listPatternComparisons(20) });
}

export async function POST(request: Request) {
  try {
    const input = parsePatternDiscoveryRequest(await request.json().catch(() => ({})));
    return NextResponse.json(await discoverPattern(input, { storage: getStorage(), bridge: localPatternDiscoveryBridge, now: () => new Date() }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: /required|must|Choose|Unexpected|invalid|needs/.test(message) ? 400 : 502 });
  }
}
