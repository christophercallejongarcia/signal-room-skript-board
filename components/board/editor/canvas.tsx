"use client";

import "@xyflow/react/dist/style.css";
import { ArrowClockwise, ArrowCounterClockwise, CornersOut, Minus, Plus } from "@phosphor-icons/react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node,
  type NodeChange,
  type OnDelete,
} from "@xyflow/react";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { connectCommand, deleteCommand, disconnectCommand, moveCommand } from "@/lib/board/commands";
import { orderedNodes } from "@/lib/board/model";
import { connectionVerdict, type Position } from "@/lib/board/ops";
import { useEditor } from "./context";
import { ConnectionEdge } from "./connection-edge";
import { ChatNodeView } from "./nodes/chat-node";
import { GroupNodeView } from "./nodes/group-node";
import { TextNodeView } from "./nodes/text-node";
import { YoutubeNodeView } from "./nodes/youtube-node";

const nodeTypes = { textNode: TextNodeView, groupNode: GroupNodeView, youtubeNode: YoutubeNodeView, chatNode: ChatNodeView };
const edgeTypes = { connectionEdge: ConnectionEdge };
const DELETE_KEYS = ["Delete", "Backspace"];

export type CanvasHandle = {
  /** Center of the visible canvas in flow coordinates. */
  viewportCenter(): Position;
  /** Last mouse position over the canvas in flow coordinates, or the center. */
  mousePosition(): Position;
  selectedIds(): string[];
  select(ids: string[]): void;
};

/** React Flow with the Poppy configuration (point 58). The session model is the truth; drags are local overrides until they stop. */
export const Canvas = forwardRef<CanvasHandle>(function Canvas(_props, ref) {
  const { session, snapshot, theme } = useEditor();
  const rf = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, Position>>(new Map());
  const dragStart = useRef(new Map<string, Position>());
  const writable = snapshot.writable;
  const model = snapshot.model;

  useImperativeHandle(ref, () => {
    const viewportCenter = (): Position => {
      const rect = wrapper.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    };
    return {
    viewportCenter,
    mousePosition() {
      if (!mouse.current) return viewportCenter();
      return rf.screenToFlowPosition(mouse.current);
    },
    selectedIds: () => [...selected],
    select: (ids) => setSelected(new Set(ids)),
    };
  });

  const nodes: Node[] = useMemo(
    () =>
      orderedNodes(model).map((node) => ({
        id: node.id,
        type: node.type,
        position: overrides.get(node.id) ?? node.position,
        width: node.width,
        height: node.height,
        style: { width: node.width, height: node.height },
        zIndex: node.zIndex,
        ...(node.parentId && model.nodes.has(node.parentId) ? { parentId: node.parentId, extent: "parent" as const } : {}),
        data: { nodeId: node.id },
        selected: selected.has(node.id),
        dragHandle: ".bd-drag",
        connectable: writable,
      })),
    [model, overrides, selected, writable],
  );

  const edges: Edge[] = useMemo(
    () => [...model.edges.values()].map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, type: "connectionEdge", animated: true })),
    [model.edges],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let nextSelected: Set<string> | null = null;
    let nextOverrides: Map<string, Position> | null = null;
    for (const change of changes) {
      if (change.type === "select") {
        nextSelected ??= new Set(selectedRef.current);
        if (change.selected) nextSelected.add(change.id);
        else nextSelected.delete(change.id);
      } else if (change.type === "position" && change.position) {
        nextOverrides ??= new Map(overridesRef.current);
        nextOverrides.set(change.id, change.position);
      }
    }
    if (nextSelected) setSelected(nextSelected);
    if (nextOverrides) setOverrides(nextOverrides);
  }, []);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const onNodeDragStart = useCallback(
    (_event: unknown, _node: Node, dragged: Node[]) => {
      dragStart.current = new Map(dragged.map((node) => [node.id, model.nodes.get(node.id)?.position ?? node.position]));
    },
    [model],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, _node: Node, dragged: Node[]) => {
      const moves = dragged
        .map((node) => ({ id: node.id, from: dragStart.current.get(node.id) ?? node.position, to: { x: Math.round(node.position.x), y: Math.round(node.position.y) } }))
        .filter((move) => session.model.nodes.has(move.id));
      void session.run(moveCommand(session.model, moves)).finally(() => setOverrides(new Map()));
    },
    [session],
  );

  const onDelete: OnDelete = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }) => {
      if (!writable) return;
      if (deletedNodes.length > 0) {
        void session.run(deleteCommand(session.model, deletedNodes.map((node) => node.id)));
        setSelected(new Set());
        return;
      }
      for (const edge of deletedEdges) void session.run(disconnectCommand(session.model, edge.id));
    },
    [session, writable],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      const source = session.model.nodes.get(connection.source);
      const target = session.model.nodes.get(connection.target);
      return connectionVerdict(source?.type ?? null, target?.type ?? null, connection.source, connection.target, connection.sourceHandle ?? "", connection.targetHandle ?? "") === null;
    },
    [session],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!writable) return;
      void session.run(connectCommand(session.model, connection.source, connection.target));
    },
    [session, writable],
  );

  return (
    <div
      ref={wrapper}
      className="bd-canvas"
      onMouseMove={(event) => {
        mouse.current = { x: event.clientX, y: event.clientY };
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onDelete={onDelete}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onPaneClick={() => {
          setSelected(new Set());
          // Canvas shortcuts must work again after clicking the empty canvas.
          const active = document.activeElement as HTMLElement | null;
          if (active && active !== document.body) active.blur();
        }}
        panOnScroll
        panOnScrollSpeed={1.5}
        panOnDrag={[0]}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
        deleteKeyCode={writable ? DELETE_KEYS : null}
        multiSelectionKeyCode={["Shift"]}
        minZoom={0.1}
        maxZoom={15}
        connectionMode={ConnectionMode.Loose}
        selectionMode={SelectionMode.Partial}
        elevateEdgesOnSelect
        elevateNodesOnSelect
        nodesDraggable={writable}
        nodesConnectable={writable}
        colorMode={theme}
        fitView={false}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--bd-dot)" />
        <Panel position="bottom-right" className="bd-zoombar">
          <button type="button" className="bd-zoom-button" aria-label="Rückgängig" title="Rückgängig (⌘Z)" disabled={!snapshot.canUndo || !writable} onClick={() => void session.undo()}>
            <ArrowCounterClockwise size={16} />
          </button>
          <button type="button" className="bd-zoom-button" aria-label="Wiederholen" title="Wiederholen (⇧⌘Z)" disabled={!snapshot.canRedo || !writable} onClick={() => void session.redo()}>
            <ArrowClockwise size={16} />
          </button>
          <button type="button" className="bd-zoom-button" aria-label="Vergrößern" title="Vergrößern" onClick={() => void rf.zoomIn()}>
            <Plus size={16} />
          </button>
          <button type="button" className="bd-zoom-button" aria-label="Verkleinern" title="Verkleinern" onClick={() => void rf.zoomOut()}>
            <Minus size={16} />
          </button>
          <button type="button" className="bd-zoom-button" aria-label="Alles zeigen" title="Alles zeigen" onClick={() => void rf.fitView({ padding: 0.15 })}>
            <CornersOut size={16} />
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
});
