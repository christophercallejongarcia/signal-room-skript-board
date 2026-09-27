/** Types for paths.mjs (shared board state outside the repo, PLAN.md point 9). */
export function boardHome(env?: Record<string, string | undefined>): string;
export function ensureBoardDir(...parts: string[]): string;
export function boardFile(...parts: string[]): string;
