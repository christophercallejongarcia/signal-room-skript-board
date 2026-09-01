import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { withCoverUrls } from "@/lib/adapters/storage/cover-cache";
import { getStorage } from "@/lib/adapters/storage";
import { STRATEGY_BRIDGE_URL } from "@/lib/config";
import {
  applyTranscriptCorrectionAction,
  mergeCorrectionSuggestions,
  parseTranscriptCorrectionRequest,
  parseTranscriptCorrectionResponse,
  parseTranscriptCorrectionAction,
  transcriptCorrectionFields,
} from "@/lib/transcript-corrections";

export const runtime = "nodejs";
export const maxDuration = 180;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function storedSignal(id: string) {
  const storage = getStorage();
  const [signals, creators] = await Promise.all([storage.listSignals(), storage.listCreators()]);
  const signal = signals.find((item) => item.id === id);
  const creator = signal ? creators.find((item) => item.id === signal.creatorId) : undefined;
  return { storage, signal, creator };
}

/** Asks the local Bridge for bounded, reviewable recognition-error suggestions. */
export async function POST(request: Request) {
  let id: string;
  try {
    id = parseTranscriptCorrectionRequest(await request.json().catch(() => ({}))).id;
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }

  const { storage, signal, creator } = await storedSignal(id);
  if (!signal) return NextResponse.json({ error: `unknown signal ${id}` }, { status: 404 });
  if (!signal.transcript?.trim()) return NextResponse.json({ error: "This Reel has no ready transcript to check." }, { status: 409 });
  if (!creator) return NextResponse.json({ error: "The Reel's Creator is missing." }, { status: 409 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${STRATEGY_BRIDGE_URL}/v1/transcript-corrections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: signal.transcript, creator: creator.handle, caption: signal.caption }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `The correction bridge answered with HTTP ${response.status}.`;
      return NextResponse.json({ error: message }, { status: response.status >= 500 ? 502 : 400 });
    }
    const suggestions = parseTranscriptCorrectionResponse(payload, signal.transcript, {
      now: new Date().toISOString(),
      idFactory: () => `correction-${randomUUID()}`,
    });
    const merged = mergeCorrectionSuggestions(signal, suggestions);
    const fields = transcriptCorrectionFields(signal.transcript, merged.transcriptCorrections ?? []);
    const saved = await storage.patchTranscript(id, fields);
    if (!saved) return NextResponse.json({ error: `unknown signal ${id}` }, { status: 404 });
    const [withCover] = await withCoverUrls([saved]);
    return NextResponse.json({ signal: withCover, added: suggestions.length });
  } catch (error) {
    return NextResponse.json({ error: "The correction bridge is unreachable." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

/** Accepts, edits or rejects one correction and re-materializes the working copy. */
export async function PATCH(request: Request) {
  let action: ReturnType<typeof parseTranscriptCorrectionAction>;
  try {
    action = parseTranscriptCorrectionAction(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }

  const { storage, signal } = await storedSignal(action.id);
  if (!signal) return NextResponse.json({ error: `unknown signal ${action.id}` }, { status: 404 });
  try {
    const updated = applyTranscriptCorrectionAction(signal, action);
    const saved = await storage.patchTranscript(action.id, {
      ...transcriptCorrectionFields(signal.transcript, updated.transcriptCorrections ?? []),
      transcriptUpdatedAt: new Date().toISOString(),
    });
    if (!saved) return NextResponse.json({ error: `unknown signal ${action.id}` }, { status: 404 });
    const [withCover] = await withCoverUrls([saved]);
    return NextResponse.json({ signal: withCover });
  } catch (error) {
    const message = errorMessage(error);
    return NextResponse.json({ error: message }, { status: message.startsWith("unknown correction") ? 404 : 400 });
  }
}

