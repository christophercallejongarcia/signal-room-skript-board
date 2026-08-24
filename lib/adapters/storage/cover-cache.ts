import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
// Relative import so `node --test` can load this file without the "@/" alias.
import type { CoverCacheResult, SignalRecord } from "../../contracts";

/**
 * Local cover cache. Instagram's CDN links are signed and expire after days,
 * so each cover is downloaded once at collection time and served from disk
 * via /api/covers/<externalId>. Files live in data/covers (gitignored).
 */

export const COVER_DIR = path.join(process.cwd(), "data", "covers");
const COVER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 5 * 1024 * 1024;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 15_000;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";
export type CacheResult = CoverCacheResult;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type CacheOptions = { dir?: string; fetch?: FetchLike };

export function isCoverId(id: string): boolean {
  return COVER_ID.test(id);
}

export function coverPath(id: string, dir = COVER_DIR): string {
  return path.join(dir, `${id}.jpg`);
}

export function coverUrl(id: string): string {
  return `/api/covers/${id}`;
}

/** Magic-byte check; the CDN sometimes answers expired links with HTML. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Only https links are fetched; a stored record must never point the server at localhost or file URLs. */
function isFetchableUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

async function download(url: string, file: string, fetchImpl: FetchLike): Promise<boolean> {
  if (!isFetchableUrl(url)) return false;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  if (!response.ok) return false;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES || !sniffImageType(bytes)) return false;
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  return true;
}

/**
 * Downloads every cover that is not on disk yet. Idempotent: a second run
 * with the same records issues no requests. Failures leave no file, so the
 * next refresh retries them.
 */
export async function cacheCovers(
  records: Pick<SignalRecord, "externalId" | "thumbnailUrl">[],
  options: CacheOptions = {},
): Promise<CacheResult> {
  const dir = options.dir ?? COVER_DIR;
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const result: CacheResult = { cached: 0, skipped: 0, failed: 0 };
  const queue = records.filter(
    (r): r is { externalId: string; thumbnailUrl: string } => Boolean(r.externalId && isCoverId(r.externalId) && r.thumbnailUrl),
  );

  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const file = coverPath(item.externalId, dir);
      if (await exists(file)) {
        result.skipped += 1;
        continue;
      }
      const ok = await download(item.thumbnailUrl, file, fetchImpl).catch(() => false);
      if (ok) result.cached += 1;
      else result.failed += 1;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return result;
}

/** Reads a cached cover; null when the id is unsafe or nothing is cached. */
export async function readCover(id: string, dir = COVER_DIR): Promise<{ bytes: Buffer; type: ImageType } | null> {
  if (!isCoverId(id)) return null;
  try {
    const bytes = await readFile(coverPath(id, dir));
    const type = sniffImageType(bytes);
    return type ? { bytes, type } : null;
  } catch {
    return null;
  }
}

/** Sets coverUrl on records whose cover is on disk. The UI never loads CDN links. */
export async function withCoverUrls<T extends Pick<SignalRecord, "externalId">>(records: T[], dir = COVER_DIR): Promise<(T & { coverUrl?: string })[]> {
  return Promise.all(
    records.map(async (record) => {
      const id = record.externalId;
      if (!id || !isCoverId(id) || !(await exists(coverPath(id, dir)))) return record;
      return { ...record, coverUrl: coverUrl(id) };
    }),
  );
}
