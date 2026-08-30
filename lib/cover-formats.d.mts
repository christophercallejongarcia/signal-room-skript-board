import type { CoverAspectRatio, CoverFormat } from "./contracts";

export declare const COVER_FORMATS: Record<CoverFormat, {
  id: CoverFormat;
  label: string;
  aspectRatio: CoverAspectRatio;
  dimensions: string;
  safeZone: string;
  layout: string;
}>;

export declare const COVER_FORMAT_IDS: readonly string[];

export declare function isCoverFormat(value: unknown): value is CoverFormat;
