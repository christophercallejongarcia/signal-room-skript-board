"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor } from "../context";

/** Inline title of a node. Typing is journaled on every change (point 24); Enter or Escape leaves the field. */
export function NodeTitle({ nodeId, placeholder, className = "bd-node-title", autoFocus = false, onDone }: { nodeId: string; placeholder: string; className?: string; autoFocus?: boolean; onDone?: () => void }) {
  const { session, snapshot, focusTitleId, actions } = useEditor();
  const stored = session.titleFor(nodeId);
  const [value, setValue] = useState(stored);
  const focused = useRef(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused.current) setValue(stored);
  }, [stored]);

  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus();
    ref.current?.select();
  }, [autoFocus]);

  useEffect(() => {
    if (focusTitleId !== nodeId) return;
    ref.current?.focus();
    ref.current?.select();
    actions.focusTitleHandled(nodeId);
  }, [focusTitleId, nodeId, actions]);

  return (
    <input
      ref={ref}
      className={`${className} nodrag`}
      value={value}
      placeholder={placeholder}
      maxLength={200}
      readOnly={!snapshot.writable}
      aria-label="Titel"
      data-title-for={nodeId}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        onDone?.();
      }}
      onChange={(event) => {
        setValue(event.target.value);
        actions.renameNode(nodeId, event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") (event.target as HTMLInputElement).blur();
      }}
    />
  );
}
