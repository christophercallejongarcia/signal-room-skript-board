/**
 * Content safety for the board (PLAN.md point 14): images and embeds only ever
 * appear as link text, links only with http, https or mailto. Also the YouTube
 * URL parser used by paste (point 64) and the bridge (point 67).
 */

const SAFE_LINK = /^(https?:|mailto:)/i;

/** Turn Markdown images into plain links and drop raw HTML media tags, before anything renders or is stored. */
export function sanitizeMarkdownMedia(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?\)/g, (_match, alt: string, url: string) => {
      const label = alt.trim() || "Bild";
      return SAFE_LINK.test(url) ? `[${label}](${url})` : label;
    })
    .replace(/<\s*(img|video|audio|iframe|embed|object|source|picture)\b[^>]*>/gi, (tag) => {
      const src = tag.match(/\s(?:src|data)\s*=\s*["']([^"']+)["']/i)?.[1];
      return src && SAFE_LINK.test(src) ? `[Medien-Link](${src})` : "";
    })
    .replace(/<\/\s*(video|audio|iframe|object|picture)\s*>/gi, "");
}

export function isSafeHref(href: string | undefined | null): boolean {
  return typeof href === "string" && SAFE_LINK.test(href.trim());
}

/**
 * The 11-character video ID of a YouTube watch, youtu.be or shorts URL, else null.
 * Playlist, time and tracking parameters are ignored (`&list=`, `&t=`, `si=`).
 */
export function youtubeVideoId(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 2000 || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text.startsWith("http") ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, "");
  let id: string | null = null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const match = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      id = match?.[1] ?? null;
    }
  } else if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0] || null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export function canonicalYoutubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
