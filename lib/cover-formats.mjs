/**
 * Shared format vocabulary for the app and the local Bridge. Keep the safe
 * zones here so a caller cannot silently use the Reel layout for YouTube.
 */
export const COVER_FORMATS = Object.freeze({
  reel: Object.freeze({
    id: "reel",
    label: "Instagram Reel",
    aspectRatio: "4:5",
    dimensions: "1024x1280",
    safeZone: "Place the overlay in the upper third. Keep the bottom 30% clear for Instagram controls.",
    layout: "Portrait composition with the subject and one visual focus centered below the text.",
  }),
  youtube: Object.freeze({
    id: "youtube",
    label: "YouTube",
    aspectRatio: "16:9",
    dimensions: "1536x864",
    safeZone: "Place the overlay in a clear side column. Keep the lower-right corner clear for the duration badge.",
    layout: "Landscape composition with the subject or proof object on the opposite side from the overlay.",
  }),
});

export const COVER_FORMAT_IDS = Object.freeze(Object.keys(COVER_FORMATS));

export function isCoverFormat(value) {
  return typeof value === "string" && Object.hasOwn(COVER_FORMATS, value);
}
