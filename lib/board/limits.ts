/**
 * Byte budgets of the board (PLAN.md points 16, 17, 19, 21, 22, 23). Client and
 * Convex check the same numbers from this one module.
 */
export const KB = 1024;
export const MB = 1024 * KB;

export const LIMITS = {
  nodesPerBoard: 500,
  notesBytes: 8 * KB,
  titleChars: 200,
  textPreviewChars: 500,
  blocksBytes: 600 * KB,
  blocksDepth: 64,
  markdownBytes: 150 * KB,
  transcriptChunkBytes: 200 * KB,
  transcriptVersionBytes: 2 * MB,
  messageBytes: 200 * KB,
  promptBytes: 20 * KB,
  textQueryBytes: 8 * MB,
  pageSize: 200,
  opsPerBatch: 100,
  opsBatchBytes: 4 * MB,
  messagesPerPage: 50,
} as const;

const encoder = new TextEncoder();

export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Nesting depth of a JSON text without building the object tree. Strings are
 * skipped with their escapes, so brackets inside text do not count.
 */
export function jsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") {
      depth += 1;
      if (depth > max) max = depth;
    } else if (char === "}" || char === "]") depth -= 1;
  }
  return max;
}

export class TextTooLargeError extends Error {
  constructor(message = "Text zu groß, bitte aufteilen.") {
    super(message);
    this.name = "TextTooLargeError";
  }
}

/** Throws `TextTooLargeError` if a text node's content breaks a budget (point 17). */
export function assertTextBudget({ blocks, markdown }: { blocks: string; markdown: string }): { blocksBytes: number; textBytes: number } {
  const blocksBytes = utf8Bytes(blocks);
  const textBytes = utf8Bytes(markdown);
  if (blocksBytes > LIMITS.blocksBytes || textBytes > LIMITS.markdownBytes) throw new TextTooLargeError();
  if (jsonDepth(blocks) > LIMITS.blocksDepth) throw new TextTooLargeError("Text ist zu tief verschachtelt, bitte vereinfachen.");
  return { blocksBytes, textBytes };
}

/** The first `max` characters without splitting a surrogate pair. */
export function previewOf(markdown: string, max: number = LIMITS.textPreviewChars): string {
  const chars = Array.from(markdown.replace(/\s+/g, " ").trim());
  return chars.slice(0, max).join("");
}

/** Cut text to at most `maxBytes` UTF-8 bytes on a code point boundary. */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (utf8Bytes(text) <= maxBytes) return { text, truncated: false };
  let bytes = 0;
  let out = "";
  for (const char of text) {
    const size = utf8Bytes(char);
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += char;
  }
  return { text: out, truncated: true };
}
