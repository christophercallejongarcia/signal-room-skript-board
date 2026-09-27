import { edgeId, newNodeId, newOpaqueId } from "./ids.ts";
import { childrenOf, type BoardModel } from "./model.ts";
import { connectionVerdict, dissolveGeometry, groupGeometry, NODE_DEFAULTS, type NodeShape, type Op, type Position, type TextContent } from "./ops.ts";

/**
 * User actions as ops plus their undo (PLAN.md point 30). Undo and redo compute
 * their ops from the model at the moment they run, so they always carry the
 * current `baseRev`. Undo produces normal ops or domain ops, never a snapshot write.
 */

export type UndoEntry = {
  label: string;
  undo(model: BoardModel): Op[];
  redo(model: BoardModel): Op[];
};

export type Command = { ops: Op[]; undo: UndoEntry | null };

export const newOpId = () => newOpaqueId("op");

export class UndoStack {
  private past: UndoEntry[] = [];
  private future: UndoEntry[] = [];
  private limit: number;

  constructor(limit = 50) {
    this.limit = limit;
  }

  push(entry: UndoEntry) {
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(model: BoardModel): Op[] {
    const entry = this.past.pop();
    if (!entry) return [];
    this.future.push(entry);
    return entry.undo(model);
  }

  redo(model: BoardModel): Op[] {
    const entry = this.future.pop();
    if (!entry) return [];
    this.past.push(entry);
    return entry.redo(model);
  }

  clear() {
    this.past = [];
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  get depth() {
    return this.past.length;
  }
}

function deleteOp(model: BoardModel, ids: string[]): Op {
  return { opId: newOpId(), type: "nodes.delete", nodes: ids.filter((id) => model.nodes.has(id)).map((id) => ({ nodeId: id, baseRev: model.nodes.get(id)!.rev })) };
}

export function createNodeCommand(shape: NodeShape, text?: TextContent): Command {
  const create: Op = { opId: newOpId(), type: "node.create", node: shape, ...(text ? { text } : {}) };
  let lastDelete: string | null = null;
  return {
    ops: [create],
    undo: {
      label: "Anlegen",
      undo(model) {
        const op = deleteOp(model, [shape.id]);
        lastDelete = op.opId;
        return op.type === "nodes.delete" && op.nodes.length > 0 ? [op] : [];
      },
      redo() {
        return lastDelete ? [{ opId: newOpId(), type: "nodes.restore", deleteOpId: lastDelete }] : [];
      },
    },
  };
}

export function deleteCommand(model: BoardModel, ids: string[]): Command {
  const first = deleteOp(model, ids);
  if (first.type !== "nodes.delete" || first.nodes.length === 0) return { ops: [], undo: null };
  let lastDelete = first.opId;
  return {
    ops: [first],
    undo: {
      label: "Löschen",
      undo: () => [{ opId: newOpId(), type: "nodes.restore", deleteOpId: lastDelete }],
      redo(current) {
        const op = deleteOp(current, ids);
        lastDelete = op.opId;
        return op.type === "nodes.delete" && op.nodes.length > 0 ? [op] : [];
      },
    },
  };
}

export function moveCommand(model: BoardModel, moves: { id: string; from: Position; to: Position }[]): Command {
  const real = moves.filter((move) => model.nodes.has(move.id) && (move.from.x !== move.to.x || move.from.y !== move.to.y));
  if (real.length === 0) return { ops: [], undo: null };
  const opsFor = (current: BoardModel, key: "from" | "to"): Op[] =>
    real.filter((move) => current.nodes.has(move.id)).map((move) => ({ opId: newOpId(), type: "node.update", nodeId: move.id, baseRev: current.nodes.get(move.id)!.rev, patch: { position: move[key] } }));
  return {
    ops: real.map((move) => ({ opId: newOpId(), type: "node.update", nodeId: move.id, baseRev: model.nodes.get(move.id)!.rev, patch: { position: move.to } })),
    undo: { label: "Verschieben", undo: (current) => opsFor(current, "from"), redo: (current) => opsFor(current, "to") },
  };
}

export function connectCommand(model: BoardModel, source: string, target: string): Command {
  const from = model.nodes.get(source);
  const to = model.nodes.get(target);
  if (!from || !to || connectionVerdict(from.type, to.type, source, target) || model.edges.has(edgeId(source, target))) return { ops: [], undo: null };
  return {
    ops: [{ opId: newOpId(), type: "edge.create", source, target }],
    undo: {
      label: "Verbinden",
      undo: () => [{ opId: newOpId(), type: "edge.delete", edgeId: edgeId(source, target) }],
      redo: (current) => (current.nodes.has(source) && current.nodes.has(target) ? [{ opId: newOpId(), type: "edge.create", source, target }] : []),
    },
  };
}

export function disconnectCommand(model: BoardModel, id: string): Command {
  const edge = model.edges.get(id);
  if (!edge) return { ops: [], undo: null };
  return {
    ops: [{ opId: newOpId(), type: "edge.delete", edgeId: id }],
    undo: {
      label: "Kante lösen",
      undo: (current) => (current.nodes.has(edge.source) && current.nodes.has(edge.target) ? [{ opId: newOpId(), type: "edge.create", source: edge.source, target: edge.target }] : []),
      redo: () => [{ opId: newOpId(), type: "edge.delete", edgeId: id }],
    },
  };
}

function groupOp(model: BoardModel, ids: string[], title: string): Op | null {
  const members = ids.map((id) => model.nodes.get(id)).filter((node): node is NonNullable<typeof node> => Boolean(node && node.type !== "groupNode" && !node.parentId));
  if (members.length === 0) return null;
  const geometry = groupGeometry(members);
  const group: NodeShape = { id: newNodeId("groupNode"), type: "groupNode", position: geometry.position, width: geometry.width, height: geometry.height, zIndex: NODE_DEFAULTS.groupNode.zIndex, data: { title } };
  return { opId: newOpId(), type: "group.create", group, children: members.map((node) => ({ nodeId: node.id, baseRev: node.rev, position: geometry.childPositions[node.id] })) };
}

function dissolveOp(model: BoardModel, groupId: string): Op | null {
  const group = model.nodes.get(groupId);
  if (!group || group.type !== "groupNode") return null;
  const children = childrenOf(model, groupId);
  const absolute = dissolveGeometry(group, children);
  return { opId: newOpId(), type: "group.dissolve", groupId, baseRev: group.rev, children: children.map((child) => ({ nodeId: child.id, baseRev: child.rev, position: absolute[child.id] })) };
}

/** Next free "Gruppe N" title. */
export function nextGroupTitle(model: BoardModel): string {
  const used = new Set([...model.nodes.values()].filter((node) => node.type === "groupNode").map((node) => node.data.title));
  let n = 1;
  while (used.has(`Gruppe ${n}`)) n += 1;
  return `Gruppe ${n}`;
}

export function groupCommand(model: BoardModel, ids: string[]): Command {
  const title = nextGroupTitle(model);
  const first = groupOp(model, ids, title);
  if (!first || first.type !== "group.create") return { ops: [], undo: null };
  const childIds = first.children.map((child) => child.nodeId);
  let groupId = first.group.id;
  return {
    ops: [first],
    undo: {
      label: "Gruppieren",
      undo(current) {
        const op = dissolveOp(current, groupId);
        return op ? [op] : [];
      },
      redo(current) {
        const op = groupOp(current, childIds, title);
        if (!op || op.type !== "group.create") return [];
        groupId = op.group.id;
        return [op];
      },
    },
  };
}

export function ungroupCommand(model: BoardModel, groupId: string): Command {
  const group = model.nodes.get(groupId);
  const first = dissolveOp(model, groupId);
  if (!group || !first || first.type !== "group.dissolve") return { ops: [], undo: null };
  const childIds = first.children.map((child) => child.nodeId);
  let currentGroup = groupId;
  return {
    ops: [first],
    undo: {
      label: "Gruppe auflösen",
      undo(current) {
        const op = groupOp(current, childIds, group.data.title);
        if (!op || op.type !== "group.create") return [];
        currentGroup = op.group.id;
        return [op];
      },
      redo(current) {
        const op = dissolveOp(current, currentGroup);
        return op ? [op] : [];
      },
    },
  };
}
