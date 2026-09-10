import type { Creator, PatternComparisonRun, PatternEvidence, PatternExclusions, PatternScope, PatternThresholds, SavePatternComparison, SignalRecord, StorageAdapter, TranscriptAnalysis } from "./contracts.ts";
import { analysisText, hashTranscriptText } from "./transcript-analysis.ts";
import { STRATEGY_BRIDGE_URL } from "./config.ts";

export type PatternDiscoveryRequest = PatternScope & { sourceSignalIds: string[] };
export type PatternHypothesis = { name: string; definition: string; structure: string[] };
export type PatternEvaluationAnswer = { verdict: "present" | "absent"; explanation: string; quote?: string; start?: number; end?: number };
export type PatternDiscoveryBridge = {
  hypothesize(input: { sources: Array<{ signalId: string; text: string }> }): Promise<PatternHypothesis>;
  evaluate(input: { definition: string; signalId: string; text: string }): Promise<PatternEvaluationAnswer>;
};
type PatternStorage = Pick<StorageAdapter, "listCreators" | "listSignals" | "listTranscriptAnalyses" | "savePatternComparison">;
export type PatternDiscoveryDeps = { storage: PatternStorage; bridge: PatternDiscoveryBridge; now: () => Date; createId: () => string; thresholds?: PatternThresholds };

async function bridgeRequest(payload: unknown) {
  const response = await fetch(`${STRATEGY_BRIDGE_URL}/v1/pattern-discovery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(125_000) });
  const value = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : `Pattern Bridge answered with HTTP ${response.status}.`);
  return value;
}

export const localPatternDiscoveryBridge: PatternDiscoveryBridge = {
  async hypothesize(input) { return await bridgeRequest({ action: "hypothesize", ...input }) as PatternHypothesis; },
  async evaluate(input) {
    const answer = await bridgeRequest({ action: "evaluate", ...input }) as Record<string, unknown>;
    const verdict = answer.verdict === "present" ? "present" : answer.verdict === "absent" ? "absent" : null;
    if (!verdict || typeof answer.explanation !== "string") throw new Error("The Pattern Bridge returned an invalid evaluation.");
    if (verdict === "present") {
      if (typeof answer.quote !== "string" || typeof answer.start !== "number" || typeof answer.end !== "number" || input.text.slice(answer.start, answer.end) !== answer.quote) throw new Error("The Pattern Bridge returned an unverified quote.");
      return { verdict, explanation: answer.explanation, quote: answer.quote, start: answer.start, end: answer.end };
    }
    return { verdict, explanation: answer.explanation };
  },
};

export function parsePatternDiscoveryRequest(value: unknown): PatternDiscoveryRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pattern discovery request must be an object.");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["sourceSignalIds", "market", "niche", "topic", "ageBucket", "owned"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Unexpected Pattern discovery field.");
  const sourceSignalIds = Array.isArray(input.sourceSignalIds)
    ? [...new Set(input.sourceSignalIds.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean))]
    : [];
  if (sourceSignalIds.length < 1 || sourceSignalIds.length > MAX_EVALUATIONS) throw new Error("Choose between 1 and 100 source Reels.");
  if (input.market !== "de" && input.market !== "en") throw new Error("market must be de or en.");
  if (input.niche !== "core" && input.niche !== "foreign") throw new Error("niche must be core or foreign.");
  if (input.ageBucket !== "0-7" && input.ageBucket !== "8-30" && input.ageBucket !== "31-90") throw new Error("ageBucket is invalid.");
  if (typeof input.topic !== "string" || !input.topic.trim() || input.topic.trim().length > 120) throw new Error("topic must contain 1 to 120 characters.");
  if (typeof input.owned !== "boolean") throw new Error("owned must be a boolean.");
  return { sourceSignalIds, market: input.market, niche: input.niche, topic: input.topic.trim(), ageBucket: input.ageBucket, owned: input.owned };
}

const DEFAULT_THRESHOLDS: PatternThresholds = { positiveReels: 5, positiveCreators: 3, negativeReels: 5 };
const MAX_EVALUATIONS = 100;

function bucketFor(publishedAt: string, now: Date): PatternScope["ageBucket"] | null {
  const days = Math.floor((now.getTime() - Date.parse(publishedAt)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0 || days > 90) return null;
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  return "31-90";
}

function median(values: number[]) {
  if (!values.length) return undefined;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function currentCompleteAnalysis(signal: SignalRecord, analyses: TranscriptAnalysis[]) {
  const source = analysisText(signal);
  if (!source) return undefined;
  const hash = hashTranscriptText(source.text);
  return analyses
    .filter((item) => item.signalId === signal.id && item.textVersion === source.textVersion && item.textHash === hash)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .find((item) => item.status === "complete" && item.complete);
}

function checkedText(signal: SignalRecord) {
  const source = analysisText(signal);
  if (!source) throw new Error(`Reel ${signal.id} has no finished transcript.`);
  return source.text;
}

function canonicalHypothesis(hypothesis: PatternHypothesis) {
  const name = hypothesis.name.trim().slice(0, 120);
  const definition = hypothesis.definition.trim().slice(0, 800);
  const structure = [...new Set(hypothesis.structure.map((item) => item.trim()).filter(Boolean))].slice(0, 12).map((item) => item.slice(0, 120));
  if (!name || !definition || structure.length === 0) throw new Error("The Bridge returned an incomplete Pattern hypothesis.");
  return { name, definition, structure };
}

function matchesScope(signal: SignalRecord, creator: Creator | undefined, scope: PatternScope, now: Date) {
  return Boolean(creator)
    && signal.format === "reel"
    && (creator!.market ?? "de") === scope.market
    && (creator!.foreign ? "foreign" : "core") === scope.niche
    && signal.topic === scope.topic
    && bucketFor(signal.publishedAt, now) === scope.ageBucket
    && Boolean(creator!.owned) === scope.owned;
}

export async function discoverPattern(request: PatternDiscoveryRequest, deps: PatternDiscoveryDeps): Promise<SavePatternComparison> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const thresholds = deps.thresholds ?? DEFAULT_THRESHOLDS;
  if (!request.sourceSignalIds.length || request.sourceSignalIds.length > MAX_EVALUATIONS) throw new Error("Choose between 1 and 100 source Reels.");
  if (![thresholds.positiveReels, thresholds.positiveCreators, thresholds.negativeReels].every((value) => Number.isInteger(value) && value > 0 && value <= MAX_EVALUATIONS)) {
    throw new Error("Pattern thresholds must be positive integers up to 100.");
  }
  const [creators, allSignals, analyses] = await Promise.all([
    deps.storage.listCreators(), deps.storage.listSignals(), deps.storage.listTranscriptAnalyses({ limit: 500 }),
  ]);
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));
  const sourceSet = new Set(request.sourceSignalIds);
  const sourceSignals = [...new Map(allSignals.filter((signal) => sourceSet.has(signal.id)).map((signal) => [signal.id, signal])).values()];
  if (sourceSignals.some((signal) => !matchesScope(signal, creatorById.get(signal.creatorId), request, now))) throw new Error("Every hypothesis source must belong to the selected comparison scope.");
  const sources = sourceSignals.flatMap((signal) => currentCompleteAnalysis(signal, analyses) ? [{ signalId: signal.id, text: checkedText(signal) }] : []);
  if (sources.length !== sourceSet.size) throw new Error("Every hypothesis source needs a current, complete transcript analysis.");
  const hypothesis = canonicalHypothesis(await deps.bridge.hypothesize({ sources }));
  const patternId = `pattern-${hashTranscriptText(hypothesis.definition.toLocaleLowerCase("de-DE")).slice(0, 20)}`;

  const excluded: PatternExclusions = { duplicate: 0, market: 0, niche: 0, topic: 0, age: 0, owned: 0, incompleteAnalysis: 0, invalidOutlier: 0 };
  const uniqueSignals: SignalRecord[] = [];
  const seen = new Set<string>();
  for (const signal of allSignals) {
    if (seen.has(signal.id)) { excluded.duplicate += 1; continue; }
    seen.add(signal.id);
    if (signal.format !== "reel") continue;
    const creator = creatorById.get(signal.creatorId);
    if (!creator || (creator.market ?? "de") !== request.market) { excluded.market += 1; continue; }
    if ((creator.foreign ? "foreign" : "core") !== request.niche) { excluded.niche += 1; continue; }
    if (signal.topic !== request.topic) { excluded.topic += 1; continue; }
    if (bucketFor(signal.publishedAt, now) !== request.ageBucket) { excluded.age += 1; continue; }
    if (Boolean(creator.owned) !== request.owned) { excluded.owned += 1; continue; }
    uniqueSignals.push(signal);
  }

  const basis = uniqueSignals
    .map((signal) => ({ signal, analysis: currentCompleteAnalysis(signal, analyses), creator: creatorById.get(signal.creatorId)! }))
    .slice(0, MAX_EVALUATIONS);
  const dataHash = hashTranscriptText(basis.map(({ signal, analysis }) => `${signal.id}:${analysis?.id ?? "unknown"}:${signal.plays ?? signal.views}`).sort().join("|"));
  const runId = `pattern-run-${hashTranscriptText(`${patternId}:${JSON.stringify({ market: request.market, niche: request.niche, topic: request.topic, ageBucket: request.ageBucket, owned: request.owned })}:${JSON.stringify(thresholds)}:${dataHash}`).slice(0, 24)}`;
  const evidence: PatternEvidence[] = [];
  for (const { signal, analysis, creator } of basis) {
    const evidenceId = `${runId}:${signal.id}`;
    if (!analysis) {
      excluded.incompleteAnalysis += 1;
      evidence.push({ id: evidenceId, patternId, runId, signalId: signal.id, verdict: "unknown", explanation: "Keine aktuelle, vollständige Inhaltsanalyse.", evaluatedAt: nowIso });
      continue;
    }
    const answer = await deps.bridge.evaluate({ definition: hypothesis.definition, signalId: signal.id, text: checkedText(signal) });
    const plays = signal.plays ?? signal.views;
    const outlier = creator.audience > 0 && Number.isFinite(creator.audience) && Number.isFinite(plays) && plays >= 0 ? plays / creator.audience : undefined;
    if (outlier === undefined) excluded.invalidOutlier += 1;
    evidence.push({
      id: evidenceId, patternId, runId, signalId: signal.id, analysisId: analysis.id,
      verdict: outlier === undefined ? "unknown" : answer.verdict,
      explanation: answer.explanation.trim().slice(0, 500) || "Explizit gegen die gespeicherte Definition geprüft.",
      ...(answer.verdict === "present" && answer.quote ? { quote: answer.quote.slice(0, 500), start: answer.start, end: answer.end } : {}),
      evaluatedAt: nowIso, ...(outlier === undefined ? {} : { outlier }),
    });
  }
  const positive = evidence.filter((item) => item.verdict === "present");
  const negative = evidence.filter((item) => item.verdict === "absent");
  const unknown = evidence.filter((item) => item.verdict === "unknown");
  const positiveCreatorCount = new Set(positive.map((item) => allSignals.find((signal) => signal.id === item.signalId)?.creatorId).filter(Boolean)).size;
  const positiveMedian = median(positive.flatMap((item) => item.outlier === undefined ? [] : [item.outlier]));
  const negativeMedian = median(negative.flatMap((item) => item.outlier === undefined ? [] : [item.outlier]));
  const medianDelta = positiveMedian === undefined || negativeMedian === undefined ? undefined : positiveMedian - negativeMedian;
  const enough = positive.length >= thresholds.positiveReels && positiveCreatorCount >= thresholds.positiveCreators && negative.length >= thresholds.negativeReels;
  const status: PatternComparisonRun["status"] = !enough ? "insufficient" : (medianDelta ?? 0) > 0 ? "candidate" : "non-positive";
  const pattern = { id: patternId, ...hypothesis, status: status === "candidate" ? "candidate" as const : "hypothesis" as const, revision: 1, createdAt: nowIso, updatedAt: nowIso };
  const run: PatternComparisonRun = {
    id: runId, patternId, createdAt: nowIso, windowDays: 90, scope: { market: request.market, niche: request.niche, topic: request.topic, ageBucket: request.ageBucket, owned: request.owned },
    thresholds, status, positiveEvidenceIds: positive.map((item) => item.id), negativeEvidenceIds: negative.map((item) => item.id), unknownEvidenceIds: unknown.map((item) => item.id),
    positiveCount: positive.length, negativeCount: negative.length, unknownCount: unknown.length, positiveCreatorCount,
    ...(positiveMedian === undefined ? {} : { positiveMedian }), ...(negativeMedian === undefined ? {} : { negativeMedian }), ...(medianDelta === undefined ? {} : { medianDelta }),
    excluded, caution: "Beobachteter Median-Unterschied. Keine Kausalität oder Erfolgsgarantie; bevorzugt transkribierte starke Reels können die Auswahl verzerren.",
  };
  return deps.storage.savePatternComparison({ pattern, evidence, run });
}
