"use client";

import { useEffect, useRef } from "react";

/** Small modal confirmation used for deletes (point 56). Escape cancels, Enter confirms. */
export function ConfirmDialog({ title, text, confirmLabel, danger, onConfirm, onCancel }: { title: string; text: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="bd-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="bd-dialog" role="dialog" aria-modal="true" aria-labelledby="bd-dialog-title">
        <h2 id="bd-dialog-title">{title}</h2>
        <p>{text}</p>
        <div className="bd-dialog-actions">
          <button type="button" className="bd-button" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="button" ref={confirmRef} className={`bd-button ${danger ? "bd-button--danger" : "bd-button--primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
