import { sanitizeMarkdownMedia } from "./markdown.ts";

/**
 * An answer as the Markdown of a new text node ("Als Text-Node", PLAN.md
 * points 86, 89): clickable titles become a numbered list, mention tags
 * `@Titel`, media link text. The title is the first heading, else "Antwort".
 */
const CLICKABLE = /<clickable-title\b[^>]*>([\s\S]*?)<\/clickable-title>/g;
const MENTION = /<poppy_reference_node\s+[^>]*title="([^"]*)"[^>]*\/>/g;

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function answerToMarkdown(text: string): string {
  let counter = 0;
  const lines = text.replace(MENTION, (_all, title: string) => `@${unescapeAttr(title)}`).split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*<clickable-title\b/.test(line) && CLICKABLE.test(line)) {
      CLICKABLE.lastIndex = 0;
      for (const match of line.matchAll(CLICKABLE)) {
        counter += 1;
        out.push(`${counter}. ${match[1].trim()}`);
      }
      continue;
    }
    CLICKABLE.lastIndex = 0;
    out.push(line.replace(CLICKABLE, (_all, title: string) => title.trim()));
  }
  return sanitizeMarkdownMedia(out.join("\n")).trim();
}

export function answerTitle(markdown: string): string {
  const heading = markdown.split("\n").find((line) => /^#{1,6}\s+\S/.test(line));
  const title = heading ? heading.replace(/^#{1,6}\s+/, "").replace(/[*_`]/g, "").trim() : "";
  return Array.from(title).slice(0, 200).join("") || "Antwort";
}
