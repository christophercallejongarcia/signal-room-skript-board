"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { isSafeHref, sanitizeMarkdownMedia } from "@/lib/board/markdown";

/**
 * Model answers as Markdown without raw HTML (PLAN.md point 14): images and
 * embeds only as link text, links only http, https and mailto with
 * `rel="noopener noreferrer"`. Nothing here can load a foreign resource.
 */
const components: Components = {
  a({ href, children }) {
    if (!isSafeHref(href)) return <span>{children}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img({ alt, src }) {
    const label = alt?.trim() || "Bild";
    const url = typeof src === "string" ? src : "";
    return isSafeHref(url) ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    ) : (
      <span>{label}</span>
    );
  },
};

/** Mention tags in user messages become readable chips. */
export function mentionsToMarkdown(text: string): string {
  return text.replace(/<poppy_reference_node\s+[^>]*title="([^"]*)"[^>]*\/>/g, (_all, title: string) => `**@${title.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")}**`);
}

export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="bd-chat-md">
      <ReactMarkdown skipHtml components={components} urlTransform={(url) => (isSafeHref(url) ? url : "")}>
        {sanitizeMarkdownMedia(text)}
      </ReactMarkdown>
    </div>
  );
});
