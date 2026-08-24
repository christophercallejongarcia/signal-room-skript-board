import type { Creator, StorageAdapter } from "../../contracts";
import { createConvexStorage } from "./convex.ts";
import { fileStorage } from "./file.ts";

export type Storage = StorageAdapter & { upsertCreator(creator: Creator): Promise<void> };

export function storageKind(): "convex" | "file" {
  return process.env.NEXT_PUBLIC_CONVEX_URL ? "convex" : "file";
}

let cached: Storage | null = null;
export function getStorage(): Storage {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  cached = url ? createConvexStorage(url) : fileStorage;
  return cached;
}
