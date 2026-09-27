/** Types for eventlog.mjs (PLAN.md point 42a). */
export type BoardEvent = { time?: number; instanceId?: string; layer?: string; deployment?: string; runId?: string; requestId?: string; boardId?: string; engine?: string; engineVersion?: string; phase?: string; durationMs?: number; code?: string; status?: number; count?: number };
export function logEvent(event: BoardEvent): void;
export function sanitizeEvent(event: BoardEvent): Record<string, string | number>;
export function rotateLogs(options?: { now?: number; dir?: string }): void;
export function logDir(): string;
export const LOG_RETENTION_DAYS: number;
export const LOG_MAX_BYTES: number;
