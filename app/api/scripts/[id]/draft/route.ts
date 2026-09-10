import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { demoScripts } from "@/lib/demo-data";
import { ForbiddenMoveError } from "@/lib/ideas";
import { demoScriptDraftSections, ScriptCopyError } from "@/lib/script-draft";
import {
  parseScriptDraftInput,
  runScriptDraft,
  ScriptDraftConflictError,
  ScriptDraftRequestError,
} from "@/lib/script-draft-run";
import { claimScriptRun, settleScriptRun } from "@/lib/scripts";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteParams = { params: Promise<{ id: string }> };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Runs the fixed synthetic Draft without reading or writing the real store. */
function draftDemoScript(id: string, input: ReturnType<typeof parseScriptDraftInput>) {
  const script = demoScripts.find((candidate) => candidate.id === id);
  if (!script) return null;
  if (script.runId) throw new ScriptDraftConflictError("This Script already has a run in progress.");
  if (script.status !== "hook-selection" && script.status !== "draft") throw new ScriptDraftConflictError();
  const selected = script.hookOptions.find((option) => option.id === input.selectedHookId);
  if (!selected) throw new ScriptDraftRequestError(`Unknown hook option ${input.selectedHookId}.`);
  const now = new Date().toISOString();
  const runId = `demo-script-draft-${script.id}`;
  const claimed = claimScriptRun(script, runId, now, { rejectIfRunning: true });
  return settleScriptRun(claimed, runId, {
    now,
    status: "draft",
    framework: input.framework,
    selectedHookId: input.selectedHookId,
    sections: demoScriptDraftSections(selected.hook),
  });
}

/** Creates or fully replaces a Script Draft after deterministic Hook and copy checks. */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const scriptId = decodeURIComponent(id).trim();
  if (!scriptId || scriptId.length > 200) return NextResponse.json({ error: "script id is invalid" }, { status: 400 });

  let input: ReturnType<typeof parseScriptDraftInput>;
  try {
    input = parseScriptDraftInput(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }

  const storage = getStorage();
  const stored = await storage.getScript(scriptId);
  if (!stored) {
    const [scripts, creators] = await Promise.all([storage.listScripts(1), storage.listCreators()]);
    if (scripts.length > 0 || creators.length > 0) return NextResponse.json({ error: `unknown script ${scriptId}` }, { status: 404 });
    try {
      const script = draftDemoScript(scriptId, input);
      if (!script) return NextResponse.json({ error: `unknown script ${scriptId}` }, { status: 404 });
      return NextResponse.json({ script, demo: true });
    } catch (error) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
    }
  }

  try {
    const result = await runScriptDraft(scriptId, input, { storage });
    if (!result) return NextResponse.json({ error: `unknown script ${scriptId}` }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ScriptDraftConflictError
      || error instanceof ScriptDraftRequestError
      || error instanceof ScriptCopyError
      || error instanceof ForbiddenMoveError
      ? 409
      : 502;
    return NextResponse.json({ error: errorMessage(error) }, { status });
  }
}
