/**
 * One PATCH body for `/api/creators`: the id plus the marks that move a creator
 * between the views. `owned` sends them to Profile only, `foreign` puts their
 * Format Signals in their own group. At least one mark, both may travel together.
 */
export type CreatorMark = { id: string; owned?: boolean; foreign?: boolean };

function readMark(input: Record<string, unknown>, key: "owned" | "foreign") {
  if (!(key in input) || input[key] === undefined) return undefined;
  if (typeof input[key] !== "boolean") throw new Error(`${key} must be true or false`);
  return input[key] as boolean;
}

/**
 * Bounds and rejects the body of `PATCH /api/creators`. The only place that
 * decides what a creator mark is; the route just maps the throw to a 400.
 */
export function parseCreatorMark(body: unknown): CreatorMark {
  const input = (body ?? {}) as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) throw new Error("id required");
  const owned = readMark(input, "owned");
  const foreign = readMark(input, "foreign");
  if (owned === undefined && foreign === undefined) throw new Error("owned or foreign required");
  return { id, ...(owned === undefined ? {} : { owned }), ...(foreign === undefined ? {} : { foreign }) };
}
