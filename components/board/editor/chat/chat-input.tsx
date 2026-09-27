"use client";

import { Node as TiptapNode, type JSONContent } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import Text from "@tiptap/extension-text";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { mentionTag } from "@/lib/board/context";

/**
 * Chat input with `@` mentions (PLAN.md point 84). The list shows only sources
 * connected to this chat, group children included; unnamed nodes appear as
 * type plus number. On send every mention becomes
 * `<poppy_reference_node nodeId="…" title="…" type="…" />` in the text.
 */
export type Mentionable = { id: string; title: string; type: "youtubeNode" | "textNode" | "groupNode" };

export type ChatInputHandle = {
  serialize(): string;
  mentions(): string[];
  clear(): void;
  focus(): void;
  setText(text: string): void;
  isEmpty(): boolean;
};

const Doc = TiptapNode.create({ name: "doc", topNode: true, content: "paragraph+" });
const Paragraph = TiptapNode.create({
  name: "paragraph",
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
});
const HardBreak = TiptapNode.create({
  name: "hardBreak",
  inline: true,
  group: "inline",
  selectable: false,
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
  addKeyboardShortcuts() {
    return { "Shift-Enter": () => this.editor.commands.insertContent({ type: this.name }) };
  },
});

const BoardMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      nodeType: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-mention-type"),
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-mention-type": attributes.nodeType }),
      },
    };
  },
});

export const TYPE_LABEL: Record<Mentionable["type"], string> = { youtubeNode: "YouTube", textNode: "Text", groupNode: "Gruppe" };

function serializeDoc(doc: JSONContent): { text: string; mentions: string[] } {
  const mentions: string[] = [];
  const paragraphs = (doc.content ?? []).map((block) =>
    (block.content ?? [])
      .map((inline) => {
        if (inline.type === "text") return inline.text ?? "";
        if (inline.type === "hardBreak") return "\n";
        if (inline.type === "mention") {
          const id = String(inline.attrs?.id ?? "");
          mentions.push(id);
          return mentionTag({ id, title: String(inline.attrs?.label ?? ""), type: String(inline.attrs?.nodeType ?? "") });
        }
        return "";
      })
      .join(""),
  );
  return { text: paragraphs.join("\n").trim(), mentions };
}

type SuggestionState = { items: Mentionable[]; index: number; command: (item: { id: string; label: string; nodeType: string }) => void } | null;

type Props = {
  mentionables: Mentionable[];
  disabled: boolean;
  placeholder: string;
  onSubmit(): void;
  onChange?(empty: boolean): void;
};

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({ mentionables, disabled, placeholder, onSubmit, onChange }, ref) {
  const mentionablesRef = useRef(mentionables);
  mentionablesRef.current = mentionables;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const [suggestion, setSuggestion] = useState<SuggestionState>(null);
  const suggestionRef = useRef<SuggestionState>(null);
  const setOpen = (value: SuggestionState) => {
    suggestionRef.current = value;
    setSuggestion(value);
  };

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      Doc,
      Paragraph,
      Text,
      HardBreak,
      UndoRedo,
      Placeholder.configure({ placeholder }),
      BoardMention.configure({
        HTMLAttributes: { class: "bd-mention" },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        renderHTML: ({ node, options }) => ["span", { ...options.HTMLAttributes, "data-mention-node-id": node.attrs.id, "data-mention-type": node.attrs.nodeType, "data-mention-title": node.attrs.label }, `@${node.attrs.label ?? node.attrs.id}`],
        suggestion: {
          char: "@",
          items: ({ query }: { query: string }) => {
            const needle = query.toLowerCase();
            return mentionablesRef.current.filter((item) => item.title.toLowerCase().includes(needle)).slice(0, 12);
          },
          render: () => ({
            onStart: (props: SuggestionProps<Mentionable>) => setOpen({ items: props.items, index: 0, command: props.command as never }),
            onUpdate: (props: SuggestionProps<Mentionable>) => setOpen({ items: props.items, index: 0, command: props.command as never }),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              const current = suggestionRef.current;
              if (!current) return false;
              if (event.key === "Escape") {
                setOpen(null);
                return true;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const step = event.key === "ArrowDown" ? 1 : -1;
                setOpen({ ...current, index: (current.index + step + current.items.length) % Math.max(current.items.length, 1) });
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                const item = current.items[current.index];
                if (item) current.command({ id: item.id, label: item.title, nodeType: item.type });
                setOpen(null);
                return true;
              }
              return false;
            },
            onExit: () => setOpen(null),
          }),
        },
      }),
    ],
    editorProps: {
      attributes: { class: "bd-chat-editor nokey", "aria-label": "Nachricht an den Chat", role: "textbox", "aria-multiline": "true" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey && !suggestionRef.current) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => onChange?.(current.isEmpty),
  });

  if (editor && editor.isEditable === disabled) editor.setEditable(!disabled);

  useImperativeHandle(ref, () => ({
    serialize: () => (editor ? serializeDoc(editor.getJSON()).text : ""),
    mentions: () => (editor ? serializeDoc(editor.getJSON()).mentions : []),
    clear: () => {
      editor?.commands.clearContent(true);
    },
    focus: () => {
      editor?.commands.focus("end");
    },
    setText: (text: string) => {
      editor?.commands.setContent({ type: "doc", content: text.split("\n").map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] })) }, { emitUpdate: true });
      editor?.commands.focus("end");
    },
    isEmpty: () => editor?.isEmpty ?? true,
  }));

  return (
    <div className="bd-chat-input nodrag nowheel nopan">
      {suggestion ? (
        <div className="bd-mention-list" role="listbox" aria-label="Quellen">
          <div className="bd-mention-head">Quellen</div>
          {suggestion.items.length === 0 ? <div className="bd-mention-empty">Keine verbundene Quelle passt.</div> : null}
          {suggestion.items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === suggestion.index}
              className={`bd-mention-item bd-mention-item--${item.type}${index === suggestion.index ? " is-active" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                suggestion.command({ id: item.id, label: item.title, nodeType: item.type });
                setOpen(null);
              }}
            >
              <span className="bd-mention-dot" />
              {item.title}
            </button>
          ))}
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
});
