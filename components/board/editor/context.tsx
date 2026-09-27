"use client";

import { createContext, useContext } from "react";
import type { BoardSession, SessionSnapshot } from "@/lib/board/board-session";
import type { Provenance } from "@/lib/board/ops";
import type { BoardTheme } from "@/lib/board/theme";

export type EditorActions = {
  deleteEdge(edgeId: string): void;
  renameNode(nodeId: string, title: string): void;
  focusTitleHandled(nodeId: string): void;
  /** "Als Text-Node" (points 86, 89): 500 × 300, 60 px right of the chat, no edge. Returns the new node ID. */
  createAnswerNode(chatNodeId: string, answer: { title: string; markdown: string; provenance?: Provenance }): Promise<string | null>;
};

export type EditorContextValue = {
  session: BoardSession;
  snapshot: SessionSnapshot;
  theme: BoardTheme;
  focusTitleId: string | null;
  actions: EditorActions;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error("useEditor außerhalb des Board-Editors.");
  return value;
}
