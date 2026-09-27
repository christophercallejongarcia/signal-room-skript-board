"use client";

import type { SessionLocks } from "./board-session.ts";
import { newOpaqueId } from "./ids.ts";

/**
 * Liveness of editor sessions via the Web Locks API: every open editor holds
 * `board-editor:<editorSessionId>` until its tab closes (PLAN.md point 28).
 */
const PREFIX = "board-editor:";
const held = new Set<string>();

function tryHold(id: string): Promise<boolean> {
  if (held.has(id)) return Promise.resolve(true);
  if (!("locks" in navigator)) return Promise.resolve(true);
  return new Promise((resolve) => {
    void navigator.locks.request(`${PREFIX}${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false);
        return undefined;
      }
      held.add(id);
      resolve(true);
      return new Promise<void>(() => {});
    });
  });
}

export const webLocks: SessionLocks = {
  hold(id) {
    void tryHold(id);
  },
  async isAlive(id) {
    if (held.has(id)) return true;
    if (!("locks" in navigator)) return false;
    const state = await navigator.locks.query();
    return (state.held ?? []).some((lock) => lock.name === `${PREFIX}${id}`);
  },
};

/**
 * The editor session of this tab: kept in sessionStorage so a reload keeps it,
 * but a duplicated tab (same sessionStorage, lock already taken) gets a new one.
 */
let claimed: Promise<string> | null = null;

export function claimEditorSessionId(): Promise<string> {
  claimed ??= claim();
  return claimed;
}

async function claim(): Promise<string> {
  const key = "board-editor-session";
  let id = sessionStorage.getItem(key);
  if (!id || !(await tryHold(id))) {
    id = newOpaqueId("editor");
    await tryHold(id);
    sessionStorage.setItem(key, id);
  }
  return id;
}
