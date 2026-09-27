"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { BlockNoteSchema, defaultBlockSpecs, type PartialBlock } from "@blocknote/core";
import { de } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useRef } from "react";
import { sanitizeMarkdownMedia } from "@/lib/board/markdown";

/**
 * BlockNote editor of a text node (PLAN.md points 14, 61). The schema has no
 * image, video, audio or file blocks; pasted media become link text.
 */
const { image: _image, video: _video, audio: _audio, file: _file, ...textBlockSpecs } = defaultBlockSpecs;
export const boardSchema = BlockNoteSchema.create({ blockSpecs: textBlockSpecs });

type Props = {
  nodeId: string;
  blocks: string;
  markdown: string;
  editable: boolean;
  theme: "light" | "dark";
  onChange(blocks: string, markdown: string): void;
};

function parseBlocks(blocks: string): PartialBlock[] | undefined {
  if (!blocks.trim()) return undefined;
  try {
    const parsed = JSON.parse(blocks);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export default function TextEditor({ nodeId, blocks, markdown, editable, theme, onChange }: Props) {
  const initial = useRef(parseBlocks(blocks));
  const editor = useCreateBlockNote(
    {
      schema: boardSchema,
      dictionary: de,
      initialContent: initial.current as never,
      pasteHandler: ({ event, editor: target }) => {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!text) return false;
        target.pasteMarkdown(sanitizeMarkdownMedia(text));
        return true;
      },
    },
    [nodeId],
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // A node created from pasted or answered Markdown has no blocks yet: build them once, on open, from that Markdown.
  const initialMarkdown = useRef(markdown);
  useEffect(() => {
    if (initial.current || !initialMarkdown.current.trim()) return;
    const parsed = editor.tryParseMarkdownToBlocks(sanitizeMarkdownMedia(initialMarkdown.current));
    if (parsed.length > 0) editor.replaceBlocks(editor.document, parsed);
    initialMarkdown.current = "";
  }, [editor]);

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={theme}
      className="bd-text-editor nodrag nowheel nopan"
      data-node-editor={nodeId}
      onChange={() => {
        const json = JSON.stringify(editor.document);
        onChangeRef.current(json, editor.blocksToMarkdownLossy(editor.document));
      }}
    />
  );
}
