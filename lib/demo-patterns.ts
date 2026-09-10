import type { PatternEvidence, SavePatternComparison } from "./contracts";

function evidence(runId: string, patternId: string, verdict: "present" | "absent", index: number): PatternEvidence {
  const position = verdict === "present" ? index : index + 5;
  return { id: `${runId}:${position}`, patternId, runId, signalId: `signal-pattern-${verdict}-${index}`, analysisId: `demo-analysis-${position}`, verdict, explanation: verdict === "present" ? "Konkreter Ergebnisbeleg steht vor dem CTA." : "Die gespeicherte Definition wurde geprüft und ist nicht erfüllt.", ...(verdict === "present" ? { quote: "Ich zeige dir das Ergebnis im Dashboard.", start: 0, end: 40 } : {}), evaluatedAt: "2026-09-10T10:00:00.000Z", outlier: verdict === "present" ? 4 + index * 0.4 : 0.7 + index * 0.1 };
}

function comparison(sufficient: boolean): SavePatternComparison {
  const patternId = sufficient ? "pattern-demo-proof" : "pattern-demo-open-loop";
  const runId = sufficient ? "pattern-run-demo-sufficient" : "pattern-run-demo-insufficient";
  const present = Array.from({ length: sufficient ? 5 : 2 }, (_, index) => evidence(runId, patternId, "present", index + 1));
  const absent = Array.from({ length: sufficient ? 5 : 1 }, (_, index) => evidence(runId, patternId, "absent", index + 1));
  const unknown: PatternEvidence[] = sufficient ? [] : [{ id: `${runId}:unknown`, patternId, runId, signalId: "signal-manual-transcript", verdict: "unknown", explanation: "Keine aktuelle, vollständige Inhaltsanalyse.", evaluatedAt: "2026-09-10T10:00:00.000Z" }];
  return {
    pattern: { id: patternId, name: sufficient ? "Beweis vor CTA" : "Offene Schleife mit Rückbezug", definition: sufficient ? "Ein überprüfbarer Ergebnisbeleg steht unmittelbar vor dem CTA." : "Eine frühe offene Frage wird vor dem CTA ausdrücklich aufgelöst.", structure: ["Behauptung", "Beleg", "CTA"], status: sufficient ? "candidate" : "hypothesis", revision: 1, createdAt: "2026-09-10T10:00:00.000Z", updatedAt: "2026-09-10T10:00:00.000Z" },
    evidence: [...present, ...absent, ...unknown],
    run: { id: runId, patternId, createdAt: "2026-09-10T10:00:00.000Z", windowDays: 90, scope: { market: "de", niche: "core", topic: "agent workflows", ageBucket: "8-30", owned: false }, thresholds: { positiveReels: 5, positiveCreators: 3, negativeReels: 5 }, status: sufficient ? "candidate" : "insufficient", positiveEvidenceIds: present.map((item) => item.id), negativeEvidenceIds: absent.map((item) => item.id), unknownEvidenceIds: unknown.map((item) => item.id), positiveCount: present.length, negativeCount: absent.length, unknownCount: unknown.length, positiveCreatorCount: sufficient ? 4 : 1, positiveMedian: sufficient ? 5.2 : 4.6, negativeMedian: sufficient ? 1 : 1.1, medianDelta: sufficient ? 4.2 : 3.5, excluded: { duplicate: 0, market: 2, niche: 0, topic: 3, age: 1, owned: 1, incompleteAnalysis: unknown.length, invalidOutlier: 0 }, caution: "Beobachteter Median-Unterschied. Keine Kausalität oder Erfolgsgarantie; bevorzugt transkribierte starke Reels können die Auswahl verzerren." },
  };
}

export const demoPatternComparisons = [comparison(true), comparison(false)];
