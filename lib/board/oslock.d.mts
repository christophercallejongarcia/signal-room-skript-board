/** Types for oslock.mjs (kernel file locks, PLAN.md point 9a). */
export type KernelLock = { fd: number; file: string; writeOwner(owner: unknown): void; release(): void };
export const O_EXLOCK: number;
export function lockingSupported(): boolean;
export function tryLock(file: string, options?: { mode?: number }): KernelLock | null;
export function isLocked(file: string): boolean;
export function readOwner(file: string): unknown;
export function tryLockAny(files: string[]): { lock: KernelLock; index: number } | null;
