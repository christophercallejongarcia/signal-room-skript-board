import { NextResponse } from "next/server";
import { demoScriptIdeaTitles, demoScripts, demoSignals } from "@/lib/demo-data";
import { getStorage } from "@/lib/adapters/storage";
import { ForbiddenMoveError } from "@/lib/ideas";
import { parseScriptPatch } from "@/lib/scripts";
import { outlierScorer } from "@/lib/adapters/scoring/outlier";
import { selectEvidenceRecords } from "@/lib/strategy-evidence";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

async function readScript(id: string) {
  const storage = getStorage();
  const script = await storage.getScript(id);
  if (script) return { script, demo: false };

  const [scripts, creators] = await Promise.all([storage.listScripts(1), storage.listCreators()]);
  if (scripts.length === 0 && creators.length === 0) {
    const demo = demoScripts.find((candidate) => candidate.id === id);
    if (demo) return { script: demo, demo: true };
  }
  return null;
}

async function enrich(script: NonNullable<Awaited<ReturnType<typeof readScript>>>) {
  const storage = getStorage();
  const [ideas, signals, creators] = await Promise.all([storage.listIdeas(200), storage.listSignals(), storage.listCreators()]);
  const idea = ideas.find((candidate) => candidate.id === script.script.ideaId);
  const signal = signals.find((candidate) => candidate.id === script.script.sourceSignalId)
    ?? demoSignals.find((candidate) => candidate.id === script.script.sourceSignalId);
  const evidenceSignals = script.script.evidenceSignalIds
    .map((id) => signals.find((candidate) => candidate.id === id) ?? demoSignals.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .map((candidate) => ({ id: candidate.id, title: candidate.title, url: candidate.url }));
  const ranked = outlierScorer.rank(signals, creators);
  const rankedById = new Map(ranked.map((candidate) => [candidate.id, candidate]));
  const evidenceCandidates = selectEvidenceRecords(ranked, creators)
    .filter((candidate) => candidate.id !== script.script.sourceSignalId);
  const candidateIds = [...script.script.evidenceSignalIds, ...evidenceCandidates.map((candidate) => candidate.id)]
    .filter((id, index, all) => id && id !== script.script.sourceSignalId && all.indexOf(id) === index);
  const linkedCandidates = candidateIds
    .map((id) => {
      const candidate = signals.find((item) => item.id === id);
      if (!candidate) return null;
      const rankedCandidate = rankedById.get(id);
      const creator = creators.find((item) => item.id === candidate.creatorId);
      return {
        id,
        title: candidate.title,
        url: candidate.url,
        creator: creator?.handle,
        outlier: rankedCandidate?.outlier,
        plays: candidate.plays ?? candidate.views,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  return {
    script: script.script,
    demo: script.demo,
    ideaTitle: idea?.title ?? demoScriptIdeaTitles[script.script.ideaId] ?? script.script.ideaId,
    storyboard: idea?.storyboard,
    forecast: idea?.forecast,
    sourceSignal: signal ? { id: signal.id, title: signal.title, url: signal.url } : null,
    evidenceSignals,
    evidenceCandidates: linkedCandidates,
  };
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const found = await readScript(decodeURIComponent(id));
  if (!found) return NextResponse.json({ error: "script not found" }, { status: 404 });
  return NextResponse.json(await enrich(found));
}

/** Applies section edits, framework changes or a manual status move atomically. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const scriptId = decodeURIComponent(id).trim();
  if (!scriptId || scriptId.length > 200) {
    return NextResponse.json({ error: "script id is invalid" }, { status: 400 });
  }
  let patch: ReturnType<typeof parseScriptPatch>;
  try {
    patch = parseScriptPatch(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  try {
    const script = await getStorage().patchScript(scriptId, patch, new Date().toISOString());
    if (!script) return NextResponse.json({ error: `unknown script ${scriptId}` }, { status: 404 });
    return NextResponse.json({ script });
  } catch (error) {
    const status = error instanceof ForbiddenMoveError ? 409 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
