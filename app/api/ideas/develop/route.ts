import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { DevelopConflictError, ForbiddenMoveError } from "@/lib/ideas";
import { ScriptHooksRequestError, runScriptHooks } from "@/lib/script-run";

export const runtime = "nodejs";
/** One Codex turn through the bridge; the bridge itself gives up after 120 s. */
export const maxDuration = 300;

/** Develop: create or open the Script and run the first Hook Selection pass. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ideaId?: unknown };
  const ideaId = typeof body.ideaId === "string" ? body.ideaId.trim() : "";
  if (!ideaId) return NextResponse.json({ error: "ideaId required" }, { status: 400 });

  const storage = getStorage();
  const [creators, signals] = await Promise.all([storage.listCreators(), storage.listSignals()]);
  try {
    const result = await runScriptHooks(ideaId, {
      storage,
      // Demo mode never sends synthetic content to the Bridge.
      demo: creators.length === 0 && signals.length === 0,
    });
    if (!result) return NextResponse.json({ error: "No idea with that id." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof DevelopConflictError || error instanceof ForbiddenMoveError || error instanceof ScriptHooksRequestError
      ? 409
      : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
