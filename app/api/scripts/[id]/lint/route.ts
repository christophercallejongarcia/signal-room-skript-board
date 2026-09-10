import { NextResponse } from "next/server";
import { demoScriptLintSuggestions, demoScripts } from "@/lib/demo-data";
import { getStorage } from "@/lib/adapters/storage";
import { ForbiddenMoveError } from "@/lib/ideas";
import { parseScriptLintResponse, scriptLintSections } from "@/lib/script-lint";
import { runScriptLint, ScriptLintConflictError, ScriptLintRequestError } from "@/lib/script-lint-run";

export const runtime = "nodejs";
export const maxDuration = 180;

type RouteParams = { params: Promise<{ id: string }> };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function demoScript(id: string) {
  const storage = getStorage();
  const [scripts, creators] = await Promise.all([storage.listScripts(1), storage.listCreators()]);
  if (scripts.length > 0 || creators.length > 0) return null;
  return demoScripts.find((script) => script.id === id) ?? null;
}

/** Starts a review-only Lektorat run. The Script itself is never changed by the run. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const scriptId = decodeURIComponent(id).trim();
  if (!scriptId || scriptId.length > 200) return NextResponse.json({ error: "script id is invalid" }, { status: 400 });

  const storage = getStorage();
  const stored = await storage.getScript(scriptId);
  if (!stored) {
    const demo = await demoScript(scriptId);
    if (!demo) return NextResponse.json({ error: `unknown script ${scriptId}` }, { status: 404 });
    if (demo.status === "approved") return NextResponse.json({ error: "An approved script is immutable until it is reopened." }, { status: 409 });
    if (demo.sections.length === 0) return NextResponse.json({ error: "A Script needs a complete draft before the Lektorat-Lauf." }, { status: 409 });
    const suggestions = parseScriptLintResponse({ suggestions: demoScriptLintSuggestions }, scriptLintSections(demo));
    return NextResponse.json({ script: demo, suggestions, demo: true });
  }

  try {
    const result = await runScriptLint(scriptId, { storage });
    if (!result) return NextResponse.json({ error: `unknown script ${scriptId}` }, { status: 404 });
    return NextResponse.json({ script: result.script, suggestions: result.suggestions, stale: result.stale ?? false });
  } catch (error) {
    const status = error instanceof ScriptLintConflictError || error instanceof ScriptLintRequestError || error instanceof ForbiddenMoveError
      ? 409
      : 502;
    return NextResponse.json({ error: errorMessage(error) }, { status });
  }
}
