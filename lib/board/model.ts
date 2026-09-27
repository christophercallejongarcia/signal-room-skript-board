import { edgeId } from "./ids.ts";
import { previewOf } from "./limits.ts";
import { makeEdge, type BoardEdge, type BoardNode, type Op } from "./ops.ts";

/**
 * The browser's copy of a board. Local ops are applied here right away with the
 * same rules Convex uses, so the predicted `rev` of every node matches what the
 * server will compute and the next op can carry the right `baseRev`.
 * Deleted items go to `trash` under the delete op's ID so undo can restore them.
 */
export type BoardModel = {
  nodes: Map<string, BoardNode>;
  edges: Map<string, BoardEdge>;
  trash: Map<string, { nodes: BoardNode[]; edges: BoardEdge[] }>;
};

export function emptyModel(): BoardModel {
  return { nodes: new Map(), edges: new Map(), trash: new Map() };
}

export function modelFrom(nodes: BoardNode[], edges: BoardEdge[]): BoardModel {
  return { nodes: new Map(nodes.map((node) => [node.id, node])), edges: new Map(edges.map((edge) => [edge.id, edge])), trash: new Map() };
}

export function cloneModel(model: BoardModel): BoardModel {
  return { nodes: new Map(model.nodes), edges: new Map(model.edges), trash: new Map(model.trash) };
}

export function childrenOf(model: BoardModel, groupId: string): BoardNode[] {
  return [...model.nodes.values()].filter((node) => node.parentId === groupId);
}

function ensureEdge(model: BoardModel, source: string, target: string) {
  const id = edgeId(source, target);
  if (!model.edges.has(id)) model.edges.set(id, makeEdge(source, target));
}

function trashFor(model: BoardModel, opId: string) {
  let entry = model.trash.get(opId);
  if (!entry) {
    entry = { nodes: [], edges: [] };
    model.trash.set(opId, entry);
  }
  return entry;
}

/** Apply one op to a copy of the model. Unknown IDs are ignored: the server decides conflicts. */
export function applyOpLocal(input: BoardModel, op: Op): BoardModel {
  const model = cloneModel(input);
  switch (op.type) {
    case "node.create": {
      const text = op.node.type === "textNode" ? { textRev: 1, textPreview: previewOf(op.text?.markdown ?? ""), textBytes: new TextEncoder().encode(op.text?.markdown ?? "").length } : {};
      model.nodes.set(op.node.id, { ...op.node, rev: 1, ...text });
      break;
    }
    case "node.update": {
      const node = model.nodes.get(op.nodeId);
      if (!node) break;
      const { data, ...geometry } = op.patch;
      model.nodes.set(node.id, { ...node, ...geometry, ...(data ? { data: { ...node.data, ...data } } : {}), rev: node.rev + 1 });
      break;
    }
    case "nodes.delete": {
      const ids = new Set(op.nodes.map((entry) => entry.nodeId).filter((id) => model.nodes.has(id)));
      for (const id of [...ids]) {
        if (model.nodes.get(id)?.type === "groupNode") for (const child of childrenOf(model, id)) ids.add(child.id);
      }
      const trash = trashFor(model, op.opId);
      for (const id of ids) {
        const node = model.nodes.get(id)!;
        trash.nodes.push({ ...node, rev: node.rev + 1 });
        model.nodes.delete(id);
      }
      for (const edge of [...model.edges.values()]) {
        if (ids.has(edge.source) || ids.has(edge.target)) {
          trash.edges.push(edge);
          model.edges.delete(edge.id);
        }
      }
      break;
    }
    case "nodes.restore": {
      const trash = model.trash.get(op.deleteOpId);
      if (!trash) break;
      const restoring = new Set(trash.nodes.map((node) => node.id));
      for (const node of trash.nodes) {
        let restored: BoardNode = { ...node, rev: node.rev + 1 };
        if (restored.parentId && !restoring.has(restored.parentId) && !model.nodes.has(restored.parentId)) {
          const { parentId: _drop, ...rest } = restored;
          restored = rest;
        }
        model.nodes.set(node.id, restored);
      }
      for (const edge of trash.edges) {
        if (model.nodes.has(edge.source) && model.nodes.has(edge.target)) model.edges.set(edge.id, edge);
      }
      model.trash.delete(op.deleteOpId);
      break;
    }
    case "text.set": {
      const node = model.nodes.get(op.nodeId);
      if (!node) break;
      model.nodes.set(node.id, { ...node, textRev: (node.textRev ?? 0) + 1, textPreview: previewOf(op.markdown), textBytes: new TextEncoder().encode(op.markdown).length });
      break;
    }
    case "edge.create":
      if (model.nodes.has(op.source) && model.nodes.has(op.target)) ensureEdge(model, op.source, op.target);
      break;
    case "edge.delete":
      model.edges.delete(op.edgeId);
      break;
    case "group.create": {
      model.nodes.set(op.group.id, { ...op.group, rev: 1 });
      const ids = new Set(op.children.map((child) => child.nodeId));
      for (const child of op.children) {
        const node = model.nodes.get(child.nodeId);
        if (node) model.nodes.set(node.id, { ...node, parentId: op.group.id, position: child.position, rev: node.rev + 1 });
      }
      const targets = new Set<string>();
      for (const edge of [...model.edges.values()]) {
        if (ids.has(edge.source)) {
          targets.add(edge.target);
          model.edges.delete(edge.id);
        }
      }
      for (const target of targets) ensureEdge(model, op.group.id, target);
      break;
    }
    case "group.dissolve": {
      const group = model.nodes.get(op.groupId);
      if (!group) break;
      const children = childrenOf(model, group.id);
      const positions = new Map(op.children.map((child) => [child.nodeId, child.position]));
      for (const child of children) {
        const { parentId: _drop, ...rest } = child;
        model.nodes.set(child.id, { ...rest, position: positions.get(child.id) ?? child.position, rev: child.rev + 1 });
      }
      const trash = trashFor(model, op.opId);
      trash.nodes.push({ ...group, rev: group.rev + 1 });
      model.nodes.delete(group.id);
      for (const edge of [...model.edges.values()]) {
        if (edge.source !== group.id) continue;
        trash.edges.push(edge);
        model.edges.delete(edge.id);
        for (const child of children) ensureEdge(model, child.id, edge.target);
      }
      break;
    }
    case "board.update":
      break;
  }
  return model;
}

/** Nodes in render order for React Flow: parents before their children. */
export function orderedNodes(model: BoardModel): BoardNode[] {
  const nodes = [...model.nodes.values()];
  const groups = nodes.filter((node) => node.type === "groupNode");
  const rest = nodes.filter((node) => node.type !== "groupNode");
  return [...groups, ...rest];
}
