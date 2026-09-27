"use client";

import { FolderSimple } from "@phosphor-icons/react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, useState } from "react";
import { useEditor } from "../context";
import { NodeTitle } from "./node-title";

/** Group (point 62): dark header, double click renames, children live inside. */
export const GroupNodeView = memo(function GroupNodeView({ id, selected }: NodeProps) {
  const { session, snapshot } = useEditor();
  const [editing, setEditing] = useState(false);
  const node = snapshot.model.nodes.get(id);
  if (!node) return null;
  return (
    <div className={`bd-node bd-node--group${selected ? " is-selected" : ""}`} data-node-id={id} data-node-type="groupNode">
      <header className="bd-node-head bd-drag" onDoubleClick={() => snapshot.writable && setEditing(true)}>
        <span className="bd-node-icon">
          <FolderSimple size={16} weight="fill" />
        </span>
        {editing ? (
          <NodeTitle nodeId={id} placeholder="Gruppe" className="bd-node-title bd-node-title--group" autoFocus onDone={() => setEditing(false)} />
        ) : (
          <span className="bd-group-title">{session.titleFor(id) || "Gruppe"}</span>
        )}
      </header>
      <div className="bd-group-body" />
      <Handle type="source" position={Position.Right} id="connector" className="bd-handle" />
    </div>
  );
});
