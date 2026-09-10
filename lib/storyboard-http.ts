import type { StorageAdapter } from "./contracts";
import { StoryboardDuplicateError } from "./storyboard.ts";
import { StoryboardConflictError, StoryboardRequestError } from "./storyboard-run.ts";

export class StoryboardIdError extends Error {
  constructor(message = "script id is invalid") {
    super(message);
    this.name = "StoryboardIdError";
  }
}

export function parseStoryboardScriptId(encoded: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded).trim();
  } catch {
    throw new StoryboardIdError();
  }
  if (!decoded || decoded.length > 200) throw new StoryboardIdError();
  return decoded;
}

export function storyboardErrorStatus(error: unknown) {
  if (error instanceof StoryboardIdError) return 400;
  if (
    error instanceof StoryboardConflictError
    || error instanceof StoryboardRequestError
    || error instanceof StoryboardDuplicateError
  ) return 409;
  return 502;
}

type EmptyStoreReader = Pick<StorageAdapter, "listScripts" | "listIdeas" | "listSignals" | "listCreators">;

/** Synthetic demo answers are allowed only when no persistent product data exists. */
export async function storeHasPersistentContent(storage: EmptyStoreReader) {
  const [scripts, ideas, signals, creators] = await Promise.all([
    storage.listScripts(1),
    storage.listIdeas(1),
    storage.listSignals(),
    storage.listCreators(),
  ]);
  return scripts.length > 0 || ideas.length > 0 || signals.length > 0 || creators.length > 0;
}
