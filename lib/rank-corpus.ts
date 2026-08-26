import { outlierScorer } from "./adapters/scoring/outlier.ts";
import type { Creator, SignalRecord } from "./contracts";
import { demoScorer } from "./demo-score.ts";

/** The instant the demo fixtures were written for. Their ages only read right against it. */
export const DEMO_NOW = new Date("2026-08-22T16:00:00.000Z");

/**
 * Ranks a corpus the one way the whole app ranks it: the real scorer against now for a
 * stored corpus, the demo scorer against the fixture date for the demo one. Desk and
 * creator detail share this, so an outlier reads the same number on both.
 */
export function rankCorpus(signals: SignalRecord[], creators: Creator[], live: boolean) {
  return (live ? outlierScorer : demoScorer).rank(signals, creators, live ? new Date() : DEMO_NOW);
}

/** One ranked signal, as every view of the app sees it. */
export type Ranked = ReturnType<typeof rankCorpus>[number];
