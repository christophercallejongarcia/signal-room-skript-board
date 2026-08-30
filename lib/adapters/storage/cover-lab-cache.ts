import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CoverFormat } from "../../contracts";
import { COVER_FORMAT_IDS } from "../../cover-formats.mjs";
import { isCoverId, sniffImageType, type ImageType, COVER_DIR } from "./cover-cache.ts";

const PACKAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONS: Record<ImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const GENERATED_ROOT = path.join(COVER_DIR, "ideas");

type CacheOptions = { dir?: string };

function validFormat(format: string): format is CoverFormat {
  return COVER_FORMAT_IDS.includes(format);
}

function assetParts(ideaId: string, format: string, packageId: string) {
  if (!isCoverId(ideaId) || !validFormat(format) || !PACKAGE_ID.test(packageId)) return null;
  return { ideaId, format, packageId };
}

function assetDirectory(ideaId: string, format: CoverFormat, dir: string) {
  return path.join(dir, "ideas", ideaId, format);
}

function assetFile(ideaId: string, format: CoverFormat, packageId: string, extension: string, dir: string) {
  return path.join(assetDirectory(ideaId, format, dir), `${packageId}.${extension}`);
}

function relativeAssetPath(file: string, dir: string) {
  const base = path.resolve(dir) === path.resolve(COVER_DIR) ? process.cwd() : dir;
  return path.relative(base, file).split(path.sep).join("/");
}

export function coverAssetUrl(ideaId: string, format: CoverFormat, packageId: string, version?: string) {
  const safe = assetParts(ideaId, format, packageId);
  if (!safe) return "";
  const base = `/api/covers/idea/${safe.ideaId}/${safe.format}/${safe.packageId}`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

/** Writes a generated raster image below data/covers/ideas and returns its relative path. */
export async function writeGeneratedCover(
  ideaId: string,
  format: CoverFormat,
  packageId: string,
  bytes: Uint8Array,
  options: CacheOptions = {},
): Promise<{ imagePath: string; type: ImageType }> {
  const dir = options.dir ?? COVER_DIR;
  const safe = assetParts(ideaId, format, packageId);
  if (!safe) throw new Error("Cover asset path is invalid.");
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("Generated cover is too large.");
  const type = sniffImageType(bytes);
  if (!type) throw new Error("Generated cover is not a supported image.");
  const extension = EXTENSIONS[type];
  const file = assetFile(ideaId, format, packageId, extension, dir);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, file);
    for (const other of Object.values(EXTENSIONS)) {
      if (other !== extension) await unlink(assetFile(ideaId, format, packageId, other, dir)).catch(() => undefined);
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return { imagePath: relativeAssetPath(file, dir), type };
}

async function firstExistingFile(ideaId: string, format: CoverFormat, packageId: string, dir: string) {
  for (const extension of Object.values(EXTENSIONS)) {
    const file = assetFile(ideaId, format, packageId, extension, dir);
    try {
      await access(file);
      return file;
    } catch {
      // Try the next supported image extension.
    }
  }
  return null;
}

/** Reads an app-generated cover without accepting path segments from the caller. */
export async function readGeneratedCover(
  ideaId: string,
  format: string,
  packageId: string,
  options: CacheOptions = {},
): Promise<{ bytes: Buffer; type: ImageType } | null> {
  const dir = options.dir ?? COVER_DIR;
  if (!assetParts(ideaId, format, packageId)) return null;
  const file = await firstExistingFile(ideaId, format as CoverFormat, packageId, dir);
  if (!file) return null;
  try {
    const bytes = await readFile(file);
    const type = sniffImageType(bytes);
    return type ? { bytes, type } : null;
  } catch {
    return null;
  }
}

/** Exported for tests and documentation; the root remains inside the ignored cover cache. */
export const COVER_LAB_DIR = GENERATED_ROOT;
