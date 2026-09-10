import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { demoCreators, demoScriptIdeaTitles, demoScripts, demoSignals } from "@/lib/demo-data";
import type { Idea } from "@/lib/contracts";
import { attachStoryboard } from "@/lib/ideas";
import {
  demoStoryboardAnswer,
  runScriptStoryboard,
} from "@/lib/storyboard-run";
import { claimScriptRun, settleScriptRun } from "@/lib/scripts";
import {
  parseStoryboardScriptId,
  storyboardErrorStatus,
  storeHasPersistentContent,
} from "@/lib/storyboard-http";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteParams = { params: Promise<{ id: string }> };

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function demoRun(scriptId: string) {
  const script = demoScripts.find((candidate) => candidate.id === scriptId);
  if (!script) return null;
  const now = new Date().toISOString();
  let currentScript = structuredClone(script);
  let idea: Idea = {
    id: script.ideaId,
    title: demoScriptIdeaTitles[script.ideaId] ?? script.ideaId,
    status: "developing",
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
  };
  const result = await runScriptStoryboard(scriptId, {
    bridge: async () => demoStoryboardAnswer,
    now: () => new Date(now),
    storage: {
      async getScript(id) { return id === scriptId ? currentScript : null; },
      async getIdea(id) { return id === idea.id ? idea : null; },
      async listSignals() { return demoSignals; },
      async listCreators() { return demoCreators; },
      async saveIdeaStoryboard(id, storyboard, options) {
        if (id !== idea.id) return null;
        idea = attachStoryboard(idea, storyboard, options);
        return idea;
      },
      async claimScriptRun(id, runId, claimedAt, options) {
        if (id !== currentScript.id) return null;
        currentScript = claimScriptRun(currentScript, runId, claimedAt, options);
        return currentScript;
      },
      async settleScriptRun(id, runId, result) {
        if (id !== currentScript.id) return null;
        const settled = settleScriptRun(currentScript, runId, result);
        if (settled) currentScript = settled;
        return settled;
      },
    },
  });
  return result.idea;
}

/** Derives an Idea Storyboard from one currently approved Script. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  let scriptId: string;
  try {
    scriptId = parseStoryboardScriptId(id);
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: storyboardErrorStatus(error) });
  }

  try {
    const storage = getStorage();
    const stored = await storage.getScript(scriptId);
    if (!stored) {
      if (await storeHasPersistentContent(storage)) {
        return NextResponse.json({ error: `unknown script ${scriptId}` }, { status: 404 });
      }
      const idea = await demoRun(scriptId);
      if (!idea) return NextResponse.json({ error: `unknown script ${scriptId}` }, { status: 404 });
      return NextResponse.json({ idea, storyboard: idea.storyboard, forecast: idea.forecast, demo: true });
    }

    const result = await runScriptStoryboard(scriptId, { storage });
    return NextResponse.json({ ...result, storyboard: result.idea.storyboard, forecast: result.idea.forecast });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: storyboardErrorStatus(error) });
  }
}
