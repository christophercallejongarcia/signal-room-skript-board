/**
 * Explicit protocol versions between the board layers (PLAN.md point 9b).
 *   protocolVersion  chat request and NDJSON events between Next and bridge
 *   opsVersion       op format and IndexedDB journal entries
 *   schemaVersion    Convex board tables (BOARD_SCHEMA_VERSION in convex/boardSchema.ts)
 * Writes with an unsupported version are rejected with 409 before anything is applied.
 */
export const PROTOCOL_VERSION = 1;
export const OPS_VERSION = 1;
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1];
export const SUPPORTED_OPS_VERSIONS: readonly number[] = [1];

export function isSupportedOpsVersion(value: unknown): value is number {
  return typeof value === "number" && SUPPORTED_OPS_VERSIONS.includes(value);
}

export function isSupportedProtocolVersion(value: unknown): value is number {
  return typeof value === "number" && SUPPORTED_PROTOCOL_VERSIONS.includes(value);
}

/** Build identity of this process: set by `dev:board` from git, else "dev". */
export function buildId(env: Record<string, string | undefined> = process.env): string {
  return env.BOARD_BUILD_ID?.trim() || "dev";
}
