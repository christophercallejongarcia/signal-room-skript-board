import type { CoverBoard, CoverFormat, CoverPackage, CoverTreatment, Idea, IdeaCoverUpdate } from "./contracts";
import { COVER_FORMATS, isCoverFormat } from "./cover-formats.mjs";
import { bounded } from "./ideas.ts";

export type { CoverFormat, CoverTreatment } from "./contracts";
export { COVER_FORMATS } from "./cover-formats.mjs";

export const COVER_PACKAGE_COUNT = 3;
export const COVER_TEXT_MAX = 60;
export const COVER_LINE_MAX = 500;
export const COVER_IMAGE_DATA_MAX = 8_000_000;

export const COVER_TREATMENTS: readonly CoverTreatment[] = ["faceless", "face"];

export type CoverRequest = {
  ideaId: string;
  format: CoverFormat;
  treatment: CoverTreatment;
  packageId?: string;
};

export type CoverRenderImage = {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
};

export type CoverResponsePackage = Omit<CoverPackage, "imagePath" | "imageUrl" | "renderedAt"> & {
  image: CoverRenderImage;
};

/** The only parser for the browser-to-server Cover-Lab request. */
export function parseCoverRequest(body: unknown): CoverRequest {
  const input = (body ?? {}) as Record<string, unknown>;
  const ideaId = bounded(input.ideaId, 200);
  if (!ideaId) throw new Error("ideaId is required.");

  const format = input.format;
  if (!isCoverFormat(format)) {
    throw new Error("format must be reel or youtube.");
  }

  const treatment = input.treatment;
  if (treatment !== "faceless" && treatment !== "face") {
    throw new Error("treatment must be faceless or face.");
  }

  const packageId = bounded(input.packageId, 64);
  return { ideaId, format, treatment, ...(packageId ? { packageId } : {}) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredLine(source: Record<string, unknown>, field: string, max = COVER_LINE_MAX) {
  const value = bounded(source[field], max);
  if (!value) throw new Error(`Cover package field ${field} is empty.`);
  return value;
}

function imageData(value: unknown): CoverRenderImage {
  if (!isObject(value)) throw new Error("Cover package image is missing.");
  const mimeType = value.mimeType;
  if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") {
    throw new Error("Cover package image must be PNG, JPEG or WebP.");
  }
  const data = typeof value.data === "string" ? value.data.trim() : "";
  if (!data || data.length > COVER_IMAGE_DATA_MAX || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new Error("Cover package image data is invalid.");
  }
  return { mimeType, data };
}

function packageFromValue(value: unknown, index: number, expectedId?: string): CoverResponsePackage {
  if (!isObject(value)) throw new Error(`Cover package ${index + 1} is invalid.`);
  const textOverlay = requiredLine(value, "textOverlay", COVER_TEXT_MAX);
  if (textOverlay.split(/\s+/).filter(Boolean).length > 4) {
    throw new Error(`Cover package ${index + 1} must use at most four overlay words.`);
  }
  return {
    id: expectedId ?? `package-${index + 1}`,
    label: requiredLine(value, "label", 120),
    textOverlay,
    imageIdea: requiredLine(value, "imageIdea"),
    colorWorld: requiredLine(value, "colorWorld"),
    imagePrompt: requiredLine(value, "imagePrompt"),
    image: imageData(value.image),
  };
}

/** Validates the complete Bridge answer before any image is written to disk. */
export function parseCoverResponse(value: unknown, options: { format: CoverFormat; packageId?: string }): CoverResponsePackage[] {
  if (!isObject(value)) throw new Error("Cover response must be an object.");
  if (value.format !== undefined && value.format !== options.format) {
    throw new Error("Cover response format does not match the request.");
  }
  if (!Array.isArray(value.packages)) throw new Error("Cover response packages are missing.");
  const expected = options.packageId ? 1 : COVER_PACKAGE_COUNT;
  const expectedLabel = expected === COVER_PACKAGE_COUNT ? "three" : "one";
  if (value.packages.length !== expected) throw new Error(`Cover response needs exactly ${expectedLabel} package${expected === 1 ? "" : "s"}.`);
  return value.packages.map((item, index) => packageFromValue(item, index, options.packageId));
}

export function coverBoard( format: CoverFormat, treatment: CoverTreatment, packages: CoverPackage[], now: string): CoverBoard {
  if (packages.length !== COVER_PACKAGE_COUNT) throw new Error(`A cover board needs exactly ${COVER_PACKAGE_COUNT} packages.`);
  return { format, aspectRatio: COVER_FORMATS[format].aspectRatio, treatment, generatedAt: now, packages };
}

/** Replaces one format slot and preserves the other format on the same Idea. */
export function upsertCoverBoard(idea: Idea, board: CoverBoard): Idea {
  const coverBoards = [...(idea.coverBoards ?? []).filter((current) => current.format !== board.format), board];
  return { ...idea, coverBoards, updatedAt: board.generatedAt };
}

/** Replaces one package while keeping the board's format and its other packages. */
export function replaceCoverPackage(idea: Idea, format: CoverFormat, replacement: CoverPackage, now: string): Idea {
  const board = idea.coverBoards?.find((current) => current.format === format);
  if (!board) throw new Error(`No ${format} cover board exists for this idea.`);
  const packages = board.packages.map((current) => (current.id === replacement.id ? replacement : current));
  if (packages.every((current) => current.id !== replacement.id)) throw new Error(`Unknown cover package ${replacement.id}.`);
  return upsertCoverBoard(idea, { ...board, packages, generatedAt: now });
}

/** Applies one Cover-Lab result to the latest Idea row supplied by storage. */
export function applyCoverUpdate(idea: Idea, update: IdeaCoverUpdate) {
  return update.kind === "board"
    ? upsertCoverBoard(idea, update.board)
    : replaceCoverPackage(idea, update.format, update.package, update.now);
}

export function coverBoardFor(idea: Idea, format: CoverFormat): CoverBoard | undefined {
  return idea.coverBoards?.find((board) => board.format === format);
}
