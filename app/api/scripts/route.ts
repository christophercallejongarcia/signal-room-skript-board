import { NextResponse } from "next/server";
import { demoScripts } from "@/lib/demo-data";
import { getStorage } from "@/lib/adapters/storage";
import { ForbiddenMoveError } from "@/lib/ideas";
import { parseScriptMove, type ScriptMove } from "@/lib/scripts";

export const runtime = "nodejs";

/** Newest first. Demo Scripts appear only while both the creator and Script stores are empty. */
export async function GET() {
  const storage = getStorage();
  const [scripts, creators] = await Promise.all([storage.listScripts(50), storage.listCreators()]);
  const demo = scripts.length === 0 && creators.length === 0;
  return NextResponse.json({ scripts: demo ? demoScripts : scripts, demo });
}

/** Manual status move. Hook-Selection to Draft stays reserved for the Draft run. */
export async function PATCH(request: Request) {
  let move: ScriptMove;
  try {
    move = parseScriptMove(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  try {
    const script = await getStorage().moveScript(move.id, move.status, new Date().toISOString());
    if (!script) return NextResponse.json({ error: `unknown script ${move.id}` }, { status: 404 });
    return NextResponse.json({ script });
  } catch (error) {
    const status = error instanceof ForbiddenMoveError ? 409 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
