"use client";

import { YoutubeLogo } from "@phosphor-icons/react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { useEditor } from "../context";

/** YouTube node shell (point 64). Metadata, transcript and actions follow in phase 3. */
export const YoutubeNodeView = memo(function YoutubeNodeView({ id, selected }: NodeProps) {
  const { session, snapshot } = useEditor();
  const node = snapshot.model.nodes.get(id);
  if (!node) return null;
  const videoId = node.data.videoId;
  return (
    <div className={`bd-node bd-node--youtube${selected ? " is-selected" : ""}`} data-node-id={id} data-node-type="youtubeNode">
      <header className="bd-node-head bd-drag">
        <span className="bd-node-icon">
          <YoutubeLogo size={16} weight="fill" />
        </span>
        <span className="bd-node-title bd-node-title--static">{session.titleFor(id) || "YouTube-Video"}</span>
      </header>
      <div className="bd-youtube-body">{videoId ? <img className="bd-youtube-thumb" src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" draggable={false} /> : null}</div>
      <Handle type="source" position={Position.Right} id="connector" className="bd-handle" />
    </div>
  );
});
