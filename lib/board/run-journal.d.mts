/** Types for run-journal.mjs (PLAN.md points 34a to 34c). */
import type { KernelLock } from "./oslock.mjs";

export type JournalFinal = { kind?: "final"; seq: number; hash: string; text: string; status: "complete" | "aborted" | "error"; reasoning?: string; usage?: { inputTokens: number; outputTokens: number }; error?: { code: string; message: string } };
export type JournalSnapshot = { kind?: "snapshot"; seq: number; hash: string; text: string; reasoning?: string };
export type JournalHeader = { kind: "header"; formatVersion: number; deploymentId: string; ownerInstanceId: string; runId: string; restoreEpoch: number; createdAt: string };
export type JournalRead = { file: string; header: JournalHeader | null; snapshot: JournalSnapshot | null; final: JournalFinal | null; mtimeMs: number };

export const JOURNAL_FORMAT: number;
export function safeName(value: string): string;
export function journalDir(deploymentId: string): string;
export function journalFile(deploymentId: string, runId: string): string;
export function holdInstanceLock(instanceId: string): KernelLock;
export function instanceAlive(instanceId: string): boolean;
export class RunJournal {
  constructor(options: { deploymentId: string; ownerInstanceId: string; runId: string; restoreEpoch?: number });
  file: string;
  header: JournalHeader;
  last: JournalSnapshot | JournalFinal | null;
  snapshot(entry: Omit<JournalSnapshot, "kind">): void;
  final(entry: Omit<JournalFinal, "kind">): void;
  remove(): void;
}
export function readJournal(file: string): JournalRead | null;
export function listJournals(deploymentId: string): JournalRead[];
export function journalStatus(deploymentId: string, now?: number): { file: string; runId: string; supported: boolean; owner: string | null; ownerAlive: boolean; hasFinal: boolean; ageMs: number }[];
export function repairDeadJournals(options: {
  deploymentId: string;
  selfInstanceId?: string;
  deliver(runId: string, final: JournalFinal): Promise<boolean>;
  bridgeState(runId: string): Promise<"unknown" | "running" | "finished">;
}): Promise<{ runId?: string; file?: string; action: string }[]>;
