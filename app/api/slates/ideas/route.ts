import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { SlateRefusal, ideaFromStart, parseSlatePosition, type SlatePosition } from "@/lib/slate";
import { findSlate } from "@/lib/slate-run";

export const runtime = "nodejs";

/**
 * The click: one start becomes an Idea with its source Signal, and the slate
 * keeps the Idea's id at that position. The Idea is written first, so a slate
 * that fails to save afterwards still leaves the Idea the person asked for. A
 * start the slate refuses (unknown position, already an Idea) is 409 with the
 * reason; a store that fails is 500.
 */
export async function POST(request: Request) {
  // parseSlatePosition bounds and rejects the body; it is the only place that decides what a position is.
  let input: SlatePosition;
  try {
    input = parseSlatePosition(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const storage = getStorage();
  const slate = await findSlate(storage, input.id);
  if (!slate) return NextResponse.json({ error: `unknown slate ${input.id}` }, { status: 404 });

  let captured: ReturnType<typeof ideaFromStart>;
  try {
    captured = ideaFromStart(slate, input.position, { id: `idea-${crypto.randomUUID()}`, now: new Date().toISOString() });
  } catch (error) {
    const status = error instanceof SlateRefusal ? 409 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
  await storage.saveIdea(captured.idea);
  await storage.saveSlate(captured.slate);
  return NextResponse.json({ idea: captured.idea, slate: captured.slate }, { status: 201 });
}
