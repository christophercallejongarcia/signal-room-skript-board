import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { newIdea, type IdeaInput } from "@/lib/ideas";

export const runtime = "nodejs";

/** The ideas repository, newest first. */
export async function GET() {
  return NextResponse.json({ ideas: await getStorage().listIdeas(50) });
}

/** Capture: from the Ideas form, or from a card with the source reel attached. */
export async function POST(request: Request) {
  // newIdea bounds and rejects the body; it is the only place that decides what a capture is.
  const body = (await request.json().catch(() => ({}))) as Partial<IdeaInput>;

  try {
    const idea = newIdea(body, {
      id: `idea-${crypto.randomUUID()}`,
      now: new Date().toISOString(),
    });
    await getStorage().saveIdea(idea);
    return NextResponse.json({ idea }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
