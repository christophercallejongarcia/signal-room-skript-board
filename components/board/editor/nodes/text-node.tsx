"use client";

import { TextT } from "@phosphor-icons/react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import dynamic from "next/dynamic";
import { memo, useEffect } from "react";
import { useEditor } from "../context";
import { NodeTitle } from "./node-title";

const TextEditor = dynamic(() => import("../text-editor"), { ssr: false, loading: () => <p className="bd-muted bd-node-loading">Editor lädt …</p> });

export type BoardFlowNodeData = { nodeId: string };

/** Text node (point 61): BlockNote body, editable only while selected; otherwise a plain preview. */
export const TextNodeView = memo(function TextNodeView({ id, selected }: NodeProps) {
  const { session, snapshot, theme } = useEditor();
  const node = snapshot.model.nodes.get(id);
  const text = session.texts.get(id);

  useEffect(() => {
    if (selected && text && !text.loaded) void session.ensureTexts([id]);
  }, [selected, text, id, session]);

  if (!node) return null;
  const preview = text?.loaded ? text.markdown : (node.textPreview ?? "");
  return (
    <div className={`bd-node bd-node--text${selected ? " is-selected" : ""}`} data-node-id={id} data-node-type="textNode">
      <header className="bd-node-head bd-drag">
        <span className="bd-node-icon">
          <TextT size={14} weight="bold" />
        </span>
        <NodeTitle nodeId={id} placeholder="Text" />
      </header>
      <div className="bd-node-body">
        {selected && text?.loaded ? (
          <TextEditor
            nodeId={id}
            blocks={text.blocks ?? ""}
            markdown={text.markdown}
            editable={snapshot.writable}
            theme={theme}
            onChange={(blocks, markdown) => void session.setText(id, blocks, markdown)}
          />
        ) : selected ? (
          <p className="bd-muted bd-node-loading">Text lädt …</p>
        ) : (
          <div className="bd-text-preview">{preview || <span className="bd-muted">Leer. Auswählen zum Schreiben.</span>}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="connector" className="bd-handle" />
    </div>
  );
});
