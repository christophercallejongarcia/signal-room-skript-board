import type { Forecast, ForecastPotential, StrategyEvidenceItem } from "./contracts";
import { bounded, STORYBOARD_LINE_MAX } from "./ideas.ts";
import { citedEvidence } from "./strategy-evidence.ts";

/**
 * Fewer comparable Reels than this is no base: one Reel is an anecdote, not a
 * range. The Idea then says "no forecast" instead of carrying its number.
 */
export const FORECAST_MIN_COMPARABLE = 2;
/** Median outlier of the comparable Reels from which potential reads medium or high. */
export const FORECAST_MEDIUM_OUTLIER = 3;
export const FORECAST_HIGH_OUTLIER = 5;

/** What the Bridge answers under `forecast`: packet titles it holds comparable, plus two lines. */
export type ForecastAnswer = {
  comparable: string[];
  risk: string;
  tension: string;
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function potentialOf(outliers: number[]): ForecastPotential {
  const typical = median(outliers);
  if (typical >= FORECAST_HIGH_OUTLIER) return "high";
  if (typical >= FORECAST_MEDIUM_OUTLIER) return "medium";
  return "low";
}

/**
 * Derives the Forecast from the Bridge answer and the packet the answer was
 * written against. Range and potential are computed here, not taken from the
 * answer: the Bridge names which Reels compare, the corpus says what they did.
 */
export function deriveForecast(answer: ForecastAnswer, evidence: StrategyEvidenceItem[]): Forecast {
  const risk = bounded(answer.risk, STORYBOARD_LINE_MAX);
  if (!risk) throw new Error("Forecast field risk is empty.");
  const tension = bounded(answer.tension, STORYBOARD_LINE_MAX);
  if (!tension) throw new Error("Forecast field tension is empty.");

  // The comparable Reels are matched like a Beleg: only titles the packet carries count.
  const comparable = citedEvidence(answer.comparable, evidence);
  if (comparable.length < FORECAST_MIN_COMPARABLE) {
    return { range: null, potential: null, comparableCount: comparable.length, risk, tension };
  }
  const plays = comparable.map((item) => item.plays);
  return {
    range: { low: Math.min(...plays), high: Math.max(...plays) },
    potential: potentialOf(comparable.map((item) => item.outlier)),
    comparableCount: comparable.length,
    risk,
    tension,
  };
}

/**
 * Reads the forecast off a whole Bridge answer. Null when the field is missing
 * or unusable: the forecast is an addition to the storyboard, never its gate.
 */
export function parseForecastAnswer(value: unknown, evidence: StrategyEvidenceItem[]): Forecast | null {
  const raw = value && typeof value === "object" ? (value as { forecast?: unknown }).forecast : undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  try {
    return deriveForecast(raw as ForecastAnswer, evidence);
  } catch {
    return null;
  }
}
