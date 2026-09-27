"use client";

import { openDB, type IDBPDatabase } from "idb";
import { journalKey, JournalWriteError, type JournalEntry, type JournalKey, type JournalStore } from "./journal.ts";

/**
 * IndexedDB store `board-journal` (PLAN.md point 24). Entries live under their
 * array key; an index on [deploymentId, boardId] lists everything of one board.
 * Test hook: `window.__boardTestHooks.failJournalWrites = true` makes every write
 * fail, only in builds with NEXT_PUBLIC_BOARD_TEST_HOOKS=1.
 */
const DB_NAME = "board-journal";
const STORE = "entries";

type Hooks = { failJournalWrites?: boolean };

function hooks(): Hooks | undefined {
  if (process.env.NEXT_PUBLIC_BOARD_TEST_HOOKS !== "1") return undefined;
  return (window as unknown as { __boardTestHooks?: Hooks }).__boardTestHooks;
}

export class IdbJournal implements JournalStore {
  private db: Promise<IDBPDatabase>;

  constructor() {
    this.db = openDB(DB_NAME, 1, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("by_board", ["deploymentId", "boardId"]);
      },
    });
  }

  async put(entry: JournalEntry) {
    if (hooks()?.failJournalWrites) throw new JournalWriteError();
    try {
      const db = await this.db;
      const tx = db.transaction(STORE, "readwrite", { durability: "strict" });
      await tx.store.put({ ...entry, key: journalKey(entry) });
      await tx.done;
    } catch (error) {
      throw error instanceof JournalWriteError ? error : new JournalWriteError(`Lokale Sicherung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async confirm(key: JournalKey, isConfirmed: (stored: JournalEntry) => boolean) {
    const db = await this.db;
    const tx = db.transaction(STORE, "readwrite");
    const stored = (await tx.store.get(key)) as JournalEntry | undefined;
    let deleted = false;
    if (stored && isConfirmed(stored)) {
      await tx.store.delete(key);
      deleted = true;
    }
    await tx.done;
    return deleted;
  }

  async remove(key: JournalKey) {
    const db = await this.db;
    await db.delete(STORE, key);
  }

  async listBoard(deploymentId: string, boardId: string) {
    const db = await this.db;
    const rows = (await db.getAllFromIndex(STORE, "by_board", [deploymentId, boardId])) as (JournalEntry & { key?: unknown })[];
    return rows.map(({ key: _key, ...entry }) => entry as JournalEntry);
  }
}
