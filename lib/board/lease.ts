/**
 * Write lease per board (PLAN.md point 28): 45 s, heartbeat every 15 s.
 * `generation` grows with every takeover by another tab; ops carrying an older
 * generation are rejected. A lease that merely expired stays with its holder
 * until someone else takes it, so a sleeping tab never loses its own ops.
 */
export const LEASE_MS = 45_000;
export const HEARTBEAT_MS = 15_000;

export type Lease = { sessionId: string; generation: number; expiresAt: number; restoreEpoch: number; oldestUnconfirmedAt?: number };

export type LeaseDecision =
  | { action: "grant" | "renew"; lease: Lease }
  | { action: "deny"; holderExpiresAt: number };

export function decideLease(current: Lease | undefined, { sessionId, now, takeover, restoreEpoch }: { sessionId: string; now: number; takeover: boolean; restoreEpoch: number }): LeaseDecision {
  if (current && current.sessionId === sessionId && current.restoreEpoch === restoreEpoch) {
    return { action: "renew", lease: { ...current, expiresAt: now + LEASE_MS } };
  }
  // A lease from before a restore is void, whoever holds it (point 9d).
  const live = current !== undefined && current.expiresAt > now && current.restoreEpoch === restoreEpoch;
  if (live && !takeover) return { action: "deny", holderExpiresAt: current.expiresAt };
  return { action: "grant", lease: { sessionId, generation: (current?.generation ?? 0) + 1, expiresAt: now + LEASE_MS, restoreEpoch } };
}

/** May this session with this generation write right now? */
export function leaseAllowsWrite(current: Lease | undefined, sessionId: string, generation: number): boolean {
  return current !== undefined && current.sessionId === sessionId && current.generation === generation;
}
