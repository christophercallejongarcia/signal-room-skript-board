"use client";

import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { useEditor } from "./context";

const SOURCE_COLOR: Record<string, string> = {
  youtubeNode: "var(--bd-youtube-sel)",
  textNode: "var(--bd-text-sel)",
  groupNode: "var(--bd-group-head)",
};

/**
 * Context edge (point 63): 2 px, dashed and animated, gradient from the source
 * color to purple in user space, red circle with a white x on hover deletes it.
 */
export const ConnectionEdge = memo(function ConnectionEdge({ id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) {
  const { snapshot, actions } = useEditor();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const gradient = `bd-grad-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const sourceType = snapshot.model.nodes.get(source)?.type ?? "textNode";
  return (
    <>
      <defs>
        <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" style={{ stopColor: SOURCE_COLOR[sourceType] ?? "var(--bd-connector)" }} />
          <stop offset="100%" style={{ stopColor: "var(--bd-edge-end)" }} />
        </linearGradient>
      </defs>
      <BaseEdge id={id} path={path} interactionWidth={24} style={{ stroke: `url(#${gradient})`, strokeWidth: 2 }} />
      {snapshot.writable ? (
        <g
          className="bd-edge-x"
          transform={`translate(${labelX} ${labelY})`}
          role="button"
          aria-label="Kante löschen"
          data-edge-delete={id}
          onClick={(event) => {
            event.stopPropagation();
            actions.deleteEdge(id);
          }}
        >
          <circle r={10} />
          <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" />
        </g>
      ) : null}
    </>
  );
});
