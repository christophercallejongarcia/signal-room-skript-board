import { randomUUID } from "node:crypto";
import { BRIDGE_TIMEOUT_MS } from "./briefing-run.ts";
import { STRATEGY_BRIDGE_URL } from "./config.ts";
import {
  analysisText,
  chunkTranscript,
  createTranscriptAnalysis,
  hashTranscriptText,
  parseTranscriptAnalysisResponse,
  timecodeForFinding,
  TRANSCRIPT_ANALYSIS_CLAIM_TIMEOUT_MS,
  TRANSCRIPT_ANALYSIS_MAX_ATTEMPTS,
  TRANSCRIPT_ANALYSIS_VERSION,
} from "./transcript-analysis.ts";
import type { SignalRecord, StorageAdapter, TranscriptAnalysis, TranscriptAnalysisFinding, TranscriptAnalysisChunkState, TranscriptAnalysisStatus } from "./contracts.ts";

export type TranscriptAnalysisQueueStorage = Pick<StorageAdapter, "listSignals" | "listTranscriptAnalyses" | "enqueueTranscriptAnalysis">;
export type TranscriptAnalysisQueueResult = { queued: number; existing: number; skipped: number; analyses: TranscriptAnalysis[]; nextCursor?: string };
export const TRANSCRIPT_ANALYSIS_CATCH_UP_INSPECTION_LIMIT = 1_000;

export async function enqueueTranscriptAnalyses(
  storage: TranscriptAnalysisQueueStorage,
  options: { now?: Date; limit?: number; cursor?: string } = {},
): Promise<TranscriptAnalysisQueueResult> {
  const now = (options.now ?? new Date()).toISOString();
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 20), 0), 100);
  const signals = await storage.listSignals();
  const candidates = signals.filter((signal) => signal.format === "reel" && isFinishedTranscript(signal));
  const cursorIndex = options.cursor ? candidates.findIndex((signal) => signal.id === options.cursor) : -1;
  if (options.cursor && cursorIndex < 0) throw new TranscriptAnalysisRequestError("The catch-up cursor does not match a finished Reel.");
  const startIndex = cursorIndex + 1;
  const analyses: TranscriptAnalysis[] = [];
  let existing = 0;
  let inspected = 0;
  let nextCursor: string | undefined;
  for (let index = startIndex; index < candidates.length; index += 1) {
    if (analyses.length >= limit || inspected >= TRANSCRIPT_ANALYSIS_CATCH_UP_INSPECTION_LIMIT) {
      nextCursor = candidates[index - 1]?.id ?? options.cursor;
      break;
    }
    const signal = candidates[index];
    const prospective = createTranscriptAnalysis(signal, now);
    if (!prospective) continue;
    inspected += 1;
    const [existingAnalysis] = await storage.listTranscriptAnalyses({ analysisId: prospective.id, limit: 1 });
    if (existingAnalysis) {
      existing += 1;
      continue;
    }
    const analysis = await storage.enqueueTranscriptAnalysis(signal.id, now);
    if (analysis) analyses.push(analysis);
  }
  return {
    queued: analyses.length,
    existing,
    skipped: Math.max(0, candidates.length - startIndex - analyses.length - existing),
    analyses,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export function isFinishedTranscript(signal: Pick<SignalRecord, "transcript" | "transcriptStatus">) {
  return Boolean(signal.transcript?.trim()) && (signal.transcriptStatus === undefined || signal.transcriptStatus === "ready");
}

export type TranscriptAnalysisBridgeRequest = {
  signalId: string;
  analysisVersion: string;
  textVersion: "original" | "working";
  text: string;
  offset: number;
  chunkIndex: number;
  chunkCount: number;
};

export type TranscriptAnalysisBridge = (request: TranscriptAnalysisBridgeRequest) => Promise<unknown>;
export type TranscriptAnalysisWorkerStorage = Pick<StorageAdapter, "listSignals" | "claimTranscriptAnalysis" | "settleTranscriptAnalysis">;
export type TranscriptAnalysisRunDeps = {
  storage: TranscriptAnalysisWorkerStorage;
  bridge: TranscriptAnalysisBridge;
  now: () => Date;
  createId: (prefix: string) => string;
  limit: number;
  chunkSize: number;
  maxChunks: number;
  analysisId?: string;
};
export type TranscriptAnalysisRunResult = { claimed: number; completed: number; failed: number; stale: number };

export class TranscriptAnalysisRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptAnalysisRequestError";
  }
}

function defaultBridge(request: TranscriptAnalysisBridgeRequest) {
  return fetch(`${STRATEGY_BRIDGE_URL}/v1/transcript-analysis`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  }).then(async (response) => {
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `The analysis Bridge answered with HTTP ${response.status}.`);
    }
    return response.json();
  });
}

function defaults(overrides: Partial<TranscriptAnalysisRunDeps>): TranscriptAnalysisRunDeps {
  return {
    storage: overrides.storage!,
    bridge: overrides.bridge ?? defaultBridge,
    now: overrides.now ?? (() => new Date()),
    createId: overrides.createId ?? ((prefix) => `${prefix}-${randomUUID()}`),
    limit: Math.min(Math.max(Math.floor(overrides.limit ?? 3), 0), 20),
    chunkSize: Math.max(2, Math.floor(overrides.chunkSize ?? 4_000)),
    maxChunks: Math.min(Math.max(Math.floor(overrides.maxChunks ?? 8), 1), 20),
    analysisId: overrides.analysisId,
  };
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "Transcript analysis failed.";
}

function currentSource(signal: SignalRecord, analysis: TranscriptAnalysis) {
  const source = analysisText(signal);
  if (!source || source.textVersion !== analysis.textVersion || hashTranscriptText(source.text) !== analysis.textHash) {
    throw new TranscriptAnalysisRequestError("The transcript changed before analysis started.");
  }
  return source;
}

function findingKey(finding: TranscriptAnalysisFinding) {
  return `${finding.feature}:${finding.start}:${finding.end}:${finding.quote}`;
}

async function settleFailure(deps: TranscriptAnalysisRunDeps, analysis: TranscriptAnalysis, claimId: string, error: unknown) {
  const settled = await deps.storage.settleTranscriptAnalysis(analysis.id, claimId, {
    status: "failed",
    now: deps.now().toISOString(),
    error: boundedError(error),
  });
  return settled;
}

async function processClaim(deps: TranscriptAnalysisRunDeps, analysis: TranscriptAnalysis, claimId: string, signals: SignalRecord[]) {
  const signal = signals.find((candidate) => candidate.id === analysis.signalId);
  if (!signal) throw new TranscriptAnalysisRequestError(`Signal ${analysis.signalId} no longer exists.`);
  const source = currentSource(signal, analysis);
  const chunks = chunkTranscript(source.text, deps.chunkSize);
  const work = chunks.slice(0, deps.maxChunks);
  const findings: TranscriptAnalysisFinding[] = [];
  let framework: "pas" | "bbb" | "none" = "none";
  for (const chunk of work) {
    const answer = parseTranscriptAnalysisResponse(await deps.bridge({
      signalId: analysis.signalId,
      analysisVersion: analysis.analysisVersion,
      textVersion: analysis.textVersion,
      text: chunk.text,
      offset: chunk.start,
      chunkIndex: chunk.index,
      chunkCount: chunks.length,
    }), chunk.text);
    if (framework === "none" && answer.framework !== "none") framework = answer.framework;
    for (const finding of answer.findings) {
      const adjusted: TranscriptAnalysisFinding = {
        ...finding,
        start: finding.start + chunk.start,
        end: finding.end + chunk.start,
      };
      const timecode = timecodeForFinding(adjusted, source.text, signal.transcript ?? "", signal.transcriptSegments ?? []);
      if (timecode) adjusted.timecode = timecode;
      if (!findings.some((existing) => findingKey(existing) === findingKey(adjusted))) findings.push(adjusted);
    }
  }
  const chunkStates: TranscriptAnalysisChunkState[] = chunks.map((chunk) => ({
    index: chunk.index,
    start: chunk.start,
    end: chunk.end,
    status: work.some((processed) => processed.index === chunk.index) ? "complete" : "missing",
  }));
  return deps.storage.settleTranscriptAnalysis(analysis.id, claimId, {
    status: "complete",
    now: deps.now().toISOString(),
    framework,
    findings,
    chunks: chunkStates,
    textLength: source.text.length,
    complete: work.length === chunks.length,
  });
}

/** Processes a bounded number of claimed jobs through the local Bridge. */
export async function processTranscriptAnalyses(overrides: Partial<TranscriptAnalysisRunDeps> = {}): Promise<TranscriptAnalysisRunResult> {
  const deps = defaults(overrides);
  if (!deps.storage) throw new Error("Transcript analysis storage is required.");
  const result: TranscriptAnalysisRunResult = { claimed: 0, completed: 0, failed: 0, stale: 0 };
  const signals = await deps.storage.listSignals();
  for (let index = 0; index < deps.limit; index += 1) {
    const claimId = deps.createId("analysis-worker");
    const analysis = await deps.storage.claimTranscriptAnalysis(deps.now().toISOString(), claimId, index === 0 ? deps.analysisId : undefined);
    if (!analysis) break;
    result.claimed += 1;
    const actualClaimId = analysis.claimId ?? claimId;
    try {
      const settled = await processClaim(deps, analysis, actualClaimId, signals);
      if (!settled) result.stale += 1;
      else result.completed += 1;
    } catch (error) {
      const settled = await settleFailure(deps, analysis, actualClaimId, error);
      if (!settled) result.stale += 1;
      else result.failed += 1;
    }
  }
  return result;
}
