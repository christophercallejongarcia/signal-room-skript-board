import { NextResponse } from "next/server";
import { SlateRefusal, parseSlatePosition, type SlatePosition } from "@/lib/slate";
import { regenerateStart } from "@/lib/slate-run";

export const runtime = "nodejs";
/** One Codex turn through the bridge; the bridge itself gives up after 120 s. */
export const maxDuration = 300;

/**
 * Writes one start anew and leaves the other nine as they are. A position the
 * slate does not carry is 409 with the reason; a Bridge that fails is 502.
 */
export async function POST(request: Request) {
  // parseSlatePosition bounds and rejects the body; it is the only place that decides what a position is.
  let input: SlatePosition;
  try {
    input = parseSlatePosition(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  try {
    const slate = await regenerateStart(input.id, input.position);
    if (!slate) return NextResponse.json({ error: `unknown slate ${input.id}` }, { status: 404 });
    return NextResponse.json({ slate });
  } catch (error) {
    const status = error instanceof SlateRefusal ? 409 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
