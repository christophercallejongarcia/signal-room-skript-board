/**
 * One PATCH body for `/api/signals`: the id plus the saved mark. true saves the
 * signal for the Saved view, false releases it.
 */
export type SignalMark = { id: string; saved: boolean };

/**
 * Bounds and rejects the body of `PATCH /api/signals`. The only place that
 * decides what a signal mark is; the route just maps the throw to a 400.
 */
export function parseSignalMark(body: unknown): SignalMark {
  const input = (body ?? {}) as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) throw new Error("id required");
  if (typeof input.saved !== "boolean") throw new Error("saved must be true or false");
  return { id, saved: input.saved };
}
