"use client";

import { ChatCircleDots, DotsSixVertical } from "@phosphor-icons/react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { useEditor } from "../context";

/** Chat node shell (point 80). The conversation UI follows in phase 5. */
export const ChatNodeView = memo(function ChatNodeView({ id, selected }: NodeProps) {
  const { session, snapshot } = useEditor();
  const node = snapshot.model.nodes.get(id);
  if (!node) return null;
  const sources = [...snapshot.model.edges.values()].filter((edge) => edge.target === id).length;
  return (
    <div className={`bd-node bd-node--chat${selected ? " is-selected" : ""}`} data-node-id={id} data-node-type="chatNode">
      <Handle type="target" position={Position.Left} id="chat-connector" className="bd-handle bd-handle--target" />
      <header className="bd-node-head bd-drag">
        <span className="bd-node-icon">
          <ChatCircleDots size={18} weight="fill" />
        </span>
        <span className="bd-node-title bd-node-title--static">{session.titleFor(id) || "Chat"}</span>
        <span className="bd-chat-move">
          <DotsSixVertical size={14} /> Verschieben
        </span>
      </header>
      <div className="bd-chat-placeholder">
        <p>{sources === 0 ? "Zieh eine Linie von einer Quelle hierher." : `${sources} ${sources === 1 ? "Quelle" : "Quellen"} verbunden.`}</p>
      </div>
    </div>
  );
});
