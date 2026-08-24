import type { Creator, SignalRecord } from "./contracts";
import { BACKFILL_DAYS } from "./config.ts";

/** Days re-requested before lastCheckedAt so late-indexed posts are not missed. */
export const OVERLAP_DAYS = 1;

const DAY_MS = 86_400_000;

/**
 * Value for the actor's onlyPostsNewerThan: a YYYY-MM-DD date for a delta run
 * (lastCheckedAt minus the overlap), or "<n> days" for the first backfill.
 */
export function refreshWindowSince(creator: Pick<Creator, "lastCheckedAt">): string {
  const cursor = creator.lastCheckedAt ? Date.parse(creator.lastCheckedAt) : NaN;
  if (Number.isNaN(cursor)) return `${BACKFILL_DAYS} days`;
  return new Date(cursor - OVERLAP_DAYS * DAY_MS).toISOString().slice(0, 10);
}

function keyOf(record: SignalRecord) {
  return record.externalId ?? record.id;
}

/**
 * Merges incoming records into the stored corpus by externalId/id. Incoming
 * fields win (fresh counters), fields the source did not deliver are kept
 * (e.g. coverUrl). Counts inserted vs updated by stored identity, so the same
 * record twice in one batch counts once.
 */
export function mergeSignals(
  existing: SignalRecord[],
  incoming: SignalRecord[],
): { signals: SignalRecord[]; inserted: number; updated: number } {
  const byKey = new Map(existing.map((record) => [keyOf(record), record]));
  const known = new Set(byKey.keys());
  const touched = new Set<string>();
  let inserted = 0;
  let updated = 0;
  for (const record of incoming) {
    const key = keyOf(record);
    const current = byKey.get(key);
    byKey.set(key, current ? { ...current, ...definedFields(record) } : record);
    if (touched.has(key)) continue;
    touched.add(key);
    if (known.has(key)) updated += 1;
    else inserted += 1;
  }
  return { signals: [...byKey.values()], inserted, updated };
}

function definedFields(record: SignalRecord): Partial<SignalRecord> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<SignalRecord>;
}
