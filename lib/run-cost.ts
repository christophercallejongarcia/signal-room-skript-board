import type { Creator, Run, RunUsage } from "./contracts";

/** What one Apify actor run reported. Both absent when Apify sent no figure. */
export type ActorUsage = { computeUnits?: number; costUsd?: number };

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Reads the usage of one actor run object as the Apify API returns it:
 * stats.computeUnits and usageTotalUsd. A missing dollar total is estimated
 * from the compute units at usdPerComputeUnit; a run without any figure stays
 * empty so it is reported as unknown, never as a free run.
 */
export function usageFromActorRun(run: unknown, usdPerComputeUnit: number): ActorUsage {
  if (!run || typeof run !== "object") return {};
  const record = run as { stats?: { computeUnits?: unknown }; usageTotalUsd?: unknown };
  const computeUnits = finite(record.stats?.computeUnits);
  const reported = finite(record.usageTotalUsd);
  const costUsd = reported ?? (computeUnits === undefined ? undefined : computeUnits * usdPerComputeUnit);
  return { ...(computeUnits === undefined ? {} : { computeUnits }), ...(costUsd === undefined ? {} : { costUsd }) };
}

/** Totals over the actor runs of one collection pass; unreported counts the runs without a figure. */
export function sumUsage(parts: ActorUsage[]): RunUsage {
  let computeUnits: number | undefined;
  let costUsd: number | undefined;
  let unreported = 0;
  for (const part of parts) {
    if (part.computeUnits === undefined && part.costUsd === undefined) {
      unreported += 1;
      continue;
    }
    if (part.computeUnits !== undefined) computeUnits = (computeUnits ?? 0) + part.computeUnits;
    if (part.costUsd !== undefined) costUsd = (costUsd ?? 0) + part.costUsd;
  }
  return { unreported, ...(computeUnits === undefined ? {} : { computeUnits }), ...(costUsd === undefined ? {} : { costUsd }) };
}

/** Adds the usage of two passes, e.g. every creator of one refresh. */
export function addUsage(a: RunUsage, b: RunUsage): RunUsage {
  const computeUnits = a.computeUnits === undefined && b.computeUnits === undefined ? undefined : (a.computeUnits ?? 0) + (b.computeUnits ?? 0);
  const costUsd = a.costUsd === undefined && b.costUsd === undefined ? undefined : (a.costUsd ?? 0) + (b.costUsd ?? 0);
  return {
    unreported: a.unreported + b.unreported,
    ...(computeUnits === undefined ? {} : { computeUnits }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

/** The running month's total as the Profile tab shows it above the run log. */
export type MonthUsage = {
  /** YYYY-MM in UTC. */
  month: string;
  /** Runs started in the month. */
  runs: number;
  /** Runs of the month without a dollar figure: logged before the guard, or unreported by Apify. */
  unknownRuns: number;
  computeUnits?: number;
  costUsd?: number;
};

export function monthUsage(runs: Pick<Run, "startedAt" | "usage">[], now: Date): MonthUsage {
  const month = now.toISOString().slice(0, 7);
  const inMonth = runs.filter((run) => run.startedAt.startsWith(month));
  let total: RunUsage = { unreported: 0 };
  let unknownRuns = 0;
  for (const run of inMonth) {
    if (run.usage?.costUsd === undefined) unknownRuns += 1;
    if (run.usage) total = addUsage(total, run.usage);
  }
  return {
    month,
    runs: inMonth.length,
    unknownRuns,
    ...(total.computeUnits === undefined ? {} : { computeUnits: total.computeUnits }),
    ...(total.costUsd === undefined ? {} : { costUsd: total.costUsd }),
  };
}

/**
 * The creators one Delta-Refresh may touch: never-checked first, then the
 * stalest cursor. The skipped ones keep their lastCheckedAt and come first
 * on the next run, so a limited refresh walks the whole list over time.
 */
export function pickRefreshBatch<T extends Pick<Creator, "lastCheckedAt">>(creators: T[], limit: number): { batch: T[]; skipped: T[] } {
  const cap = Math.max(1, Math.floor(limit));
  const ordered = [...creators].sort((a, b) => (a.lastCheckedAt ?? "").localeCompare(b.lastCheckedAt ?? ""));
  return { batch: ordered.slice(0, cap), skipped: ordered.slice(cap) };
}
