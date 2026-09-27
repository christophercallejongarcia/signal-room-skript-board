"use client";

import { ChatCircleDots, DotsSixVertical, Warning } from "@phosphor-icons/react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import dynamic from "next/dynamic";
import { memo, useMemo } from "react";
import { useEditor } from "../context";
import { useSources } from "../sources";

const ChatPanel = dynamic(() => import("../chat/chat-panel"), { ssr: false, loading: () => <p className="bd-muted bd-node-loading">Chat lädt …</p> });

/**
 * Chat node (PLAN.md point 80): 800 × 700, zIndex 10, input handle on the left.
 * The header warns when a connected YouTube source is not ready (point 72).
 */
export const ChatNodeView = memo(function ChatNodeView({ id, selected }: NodeProps) {
  const { session, snapshot } = useEditor();
  const { sources } = useSources();
  const node = snapshot.model.nodes.get(id);

  const notReady = useMemo(() => {
    const model = snapshot.model;
    const connected = new Set<string>();
    for (const edge of model.edges.values()) {
      if (edge.target !== id) continue;
      connected.add(edge.source);
      if (model.nodes.get(edge.source)?.type === "groupNode") {
        for (const child of model.nodes.values()) if (child.parentId === edge.source) connected.add(child.id);
      }
    }
    return [...connected].filter((nodeId) => {
      const entry = model.nodes.get(nodeId);
      if (entry?.type !== "youtubeNode" || !entry.data.videoId) return false;
      return sources.get(entry.data.videoId)?.transcriptStatus !== "ready";
    }).length;
  }, [snapshot.model, id, sources]);

  if (!node) return null;
  return (
    <div className={`bd-node bd-node--chat${selected ? " is-selected" : ""}`} data-node-id={id} data-node-type="chatNode">
      <Handle type="target" position={Position.Left} id="chat-connector" className="bd-handle bd-handle--target" />
      <header className="bd-node-head bd-drag">
        <span className="bd-node-icon">
          <ChatCircleDots size={18} weight="fill" />
        </span>
        <span className="bd-node-title bd-node-title--static">{session.titleFor(id) || "Chat"}</span>
        {notReady > 0 ? (
          <span className="bd-chat-head-warning" data-testid="chat-head-warning" title="Senden erst, wenn alle Quellen bereit sind oder für diese Nachricht nur mit Titel freigegeben.">
            <Warning size={14} weight="fill" /> {notReady} {notReady === 1 ? "Quelle nicht bereit" : "Quellen nicht bereit"}
          </span>
        ) : null}
        <span className="bd-chat-move">
          <DotsSixVertical size={14} /> Verschieben
        </span>
      </header>
      <div className="bd-node-body bd-chat-body">
        <ChatPanel nodeId={id} selected={Boolean(selected)} />
      </div>
    </div>
  );
});
