import type { Op, Provenance } from "./ops.ts";

/**
 * Local journal before the network (PLAN.md point 24). Key:
 * `[deploymentId, boardId, editorSessionId, entryKey]`.
 *   op:<opId>      immutable structure op
 *   text:<nodeId>  latest local text of a node, overwritten on every keystroke with a growing localVersion
 *   title:<nodeId> latest local title of a node, same rule
 * A confirmation deletes only the entry whose opId or localVersion was confirmed,
 * so a late confirmation never deletes a newer local state.
 */

export type JournalScope = { deploymentId: string; boardId: string; editorSessionId: string };

type Base = JournalScope & {
  entryKey: string;
  opsVersion: number;
  restoreEpoch: number;
  /** Lease this entry was written under; decides whether a later session may adopt it. */
  leaseSessionId: string;
  leaseGeneration: number;
  updatedAt: number;
};

export type OpEntry = Base & { kind: "op"; op: Op };
export type TextEntry = Base & { kind: "text"; nodeId: string; blocks: string; markdown: string; provenance?: Provenance; localVersion: number; baseTextRev: number };
/** Title or notes of a node: `field` defaults to "title" (entry key `title:<id>` or `notes:<id>`). */
export type TitleEntry = Base & { kind: "title"; nodeId: string; title: string; localVersion: number; field?: "title" | "notes" };
export type JournalEntry = OpEntry | TextEntry | TitleEntry;

export type JournalKey = [string, string, string, string];

export function journalKey(entry: Pick<JournalEntry, "deploymentId" | "boardId" | "editorSessionId" | "entryKey">): JournalKey {
  return [entry.deploymentId, entry.boardId, entry.editorSessionId, entry.entryKey];
}

export const opKey = (opId: string) => `op:${opId}`;
export const textKey = (nodeId: string) => `text:${nodeId}`;
export const titleKey = (nodeId: string, field: "title" | "notes" = "title") => `${field}:${nodeId}`;

export class JournalWriteError extends Error {
  constructor(message = "Lokale Sicherung fehlgeschlagen.") {
    super(message);
    this.name = "JournalWriteError";
  }
}

export interface JournalStore {
  put(entry: JournalEntry): Promise<void>;
  /** Delete in one transaction, but only if `keep` says the stored entry is the confirmed one. */
  confirm(key: JournalKey, isConfirmed: (stored: JournalEntry) => boolean): Promise<boolean>;
  remove(key: JournalKey): Promise<void>;
  listBoard(deploymentId: string, boardId: string): Promise<JournalEntry[]>;
}

/** In-memory journal for tests and as a stand-in when IndexedDB is missing. */
export class MemoryJournal implements JournalStore {
  entries = new Map<string, JournalEntry>();
  failWrites = false;

  async put(entry: JournalEntry) {
    if (this.failWrites) throw new JournalWriteError();
    this.entries.set(JSON.stringify(journalKey(entry)), structuredClone(entry));
  }

  async confirm(key: JournalKey, isConfirmed: (stored: JournalEntry) => boolean) {
    const id = JSON.stringify(key);
    const stored = this.entries.get(id);
    if (!stored || !isConfirmed(stored)) return false;
    this.entries.delete(id);
    return true;
  }

  async remove(key: JournalKey) {
    this.entries.delete(JSON.stringify(key));
  }

  async listBoard(deploymentId: string, boardId: string) {
    return [...this.entries.values()].filter((entry) => entry.deploymentId === deploymentId && entry.boardId === boardId).map((entry) => structuredClone(entry));
  }
}

/** Confirmation predicates. */
export function confirmsOp(opId: string) {
  return (stored: JournalEntry) => stored.kind === "op" && stored.op.opId === opId;
}

export function confirmsVersion(localVersion: number) {
  return (stored: JournalEntry) => (stored.kind === "text" || stored.kind === "title") && stored.localVersion === localVersion;
}
