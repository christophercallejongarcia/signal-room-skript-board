import type { BoardModel } from "./model.ts";
import type { Position } from "./ops.ts";

/** Absolute rectangle of a node (children of a group are stored relative to it). */
export function absoluteRect(model: BoardModel, id: string): { x: number; y: number; width: number; height: number } | null {
  const node = model.nodes.get(id);
  if (!node) return null;
  const parent = node.parentId ? model.nodes.get(node.parentId) : undefined;
  return { x: node.position.x + (parent?.position.x ?? 0), y: node.position.y + (parent?.position.y ?? 0), width: node.width, height: node.height };
}

const GAP = 60;

/**
 * A spot for a new node at `wanted` that does not cover an existing top-level
 * node: shift right past whatever it would overlap, at most 20 times.
 */
export function freeSpot(model: BoardModel, wanted: Position, size: { width: number; height: number }): Position {
  const rects = [...model.nodes.keys()].map((id) => absoluteRect(model, id)!).filter(Boolean);
  let position = { ...wanted };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const hit = rects.find((rect) => position.x < rect.x + rect.width + GAP / 2 && position.x + size.width > rect.x - GAP / 2 && position.y < rect.y + rect.height && position.y + size.height > rect.y);
    if (!hit) return position;
    position = { x: hit.x + hit.width + GAP, y: position.y };
  }
  return position;
}
