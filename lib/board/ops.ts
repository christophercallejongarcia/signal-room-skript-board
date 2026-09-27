import { edgeId, isNodeId, nodeTypeOfId, type NodeType } from "./ids.ts";
import { LIMITS, utf8Bytes } from "./limits.ts";

/**
 * The op format between browser and Convex, `opsVersion` 1 (PLAN.md points 24 to 31).
 * Structure ops carry `baseRev` per entity; text ops carry `baseTextRev`.
 * Domain ops (group, dissolve, delete) are applied all-or-nothing by Convex.
 */

export type Position = { x: number; y: number };
export type Engine = "claude" | "codex" | "command-code";
export type Effort = "instant" | "low" | "medium" | "high";

export type NodeData = {
  title: string;
  notes?: string;
  videoId?: string;
  url?: string;
  engine?: Engine;
  modelId?: string;
  effort?: Effort;
  brandVoice?: "none" | "chris";
};

export type NodeShape = {
  id: string;
  type: NodeType;
  position: Position;
  width: number;
  height: number;
  zIndex: number;
  parentId?: string;
  data: NodeData;
};

export type BoardNode = NodeShape & {
  rev: number;
  textBytes?: number;
  blocksBytes?: number;
  textPreview?: string;
  textRev?: number;
  deletedAt?: number;
};

export type BoardEdge = { id: string; source: string; target: string; sourceHandle: "connector"; targetHandle: "chat-connector"; type: "connectionEdge" };

export type Provenance = { youtube: { videoId: string; versionId: string; title?: string; url?: string }[]; texts: { nodeId: string; hash: string }[] };

export type TextContent = { blocks: string; markdown: string; provenance?: Provenance };

export type NodePatch = Partial<Pick<NodeShape, "position" | "width" | "height" | "zIndex">> & { data?: Partial<NodeData> };

export type Op =
  | { opId: string; type: "node.create"; node: NodeShape; text?: TextContent }
  | { opId: string; type: "node.update"; nodeId: string; baseRev: number; patch: NodePatch }
  | { opId: string; type: "nodes.delete"; nodes: { nodeId: string; baseRev: number }[] }
  | { opId: string; type: "nodes.restore"; deleteOpId: string }
  | { opId: string; type: "text.set"; nodeId: string; baseTextRev: number; blocks: string; markdown: string; provenance?: Provenance }
  | { opId: string; type: "edge.create"; source: string; target: string }
  | { opId: string; type: "edge.delete"; edgeId: string }
  | { opId: string; type: "group.create"; group: NodeShape; children: { nodeId: string; baseRev: number; position: Position }[] }
  | { opId: string; type: "group.dissolve"; groupId: string; baseRev: number; children: { nodeId: string; baseRev: number; position: Position }[] }
  | { opId: string; type: "board.update"; patch: { title?: string; brandVoiceText?: string; videoSlug?: string | null } };

export type OpResult = { opId: string; status: "applied" | "duplicate" | "conflict"; reason?: string; rev?: number; textRev?: number };

export const NODE_DEFAULTS: Record<NodeType, { width: number; height: number; zIndex: number }> = {
  youtubeNode: { width: 290, height: 206, zIndex: 1 },
  textNode: { width: 500, height: 300, zIndex: 1 },
  groupNode: { width: 400, height: 300, zIndex: -1 },
  chatNode: { width: 800, height: 700, zIndex: 10 },
};

/** Where the first child of a group sits relative to the group (Poppy scenario 4). */
export const GROUP_PADDING = { left: 40, top: 80, right: 40, bottom: 40 };

export class OpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpValidationError";
  }
}

const OP_TYPES = new Set(["node.create", "node.update", "nodes.delete", "nodes.restore", "text.set", "edge.create", "edge.delete", "group.create", "group.dissolve", "board.update"]);
const ENGINES = new Set(["claude", "codex", "command-code"]);
const EFFORTS = new Set(["instant", "low", "medium", "high"]);

function fail(message: string): never {
  throw new OpValidationError(message);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function checkPosition(value: unknown, label: string): Position {
  const position = value as Position;
  if (!position || !isFiniteNumber(position.x) || !isFiniteNumber(position.y) || Math.abs(position.x) > 1e7 || Math.abs(position.y) > 1e7) fail(`${label}: ungültige Position.`);
  return { x: position.x, y: position.y };
}

function checkRev(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) fail(`${label}: ungültige Revision.`);
  return value as number;
}

function checkData(data: unknown, partial: boolean): Partial<NodeData> {
  if (!data || typeof data !== "object") fail("data fehlt.");
  const input = data as Record<string, unknown>;
  const out: Partial<NodeData> = {};
  for (const key of Object.keys(input)) {
    if (!["title", "notes", "videoId", "url", "engine", "modelId", "effort", "brandVoice"].includes(key)) fail(`Unbekanntes Feld data.${key}.`);
  }
  if (input.title !== undefined || !partial) {
    if (typeof input.title !== "string" || Array.from(input.title).length > LIMITS.titleChars) fail("Titel fehlt oder ist zu lang.");
    out.title = input.title;
  }
  if (input.notes !== undefined) {
    if (typeof input.notes !== "string" || utf8Bytes(input.notes) > LIMITS.notesBytes) fail("Notizen sind zu lang (höchstens 8 KB).");
    out.notes = input.notes;
  }
  if (input.videoId !== undefined) {
    if (typeof input.videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(input.videoId)) fail("Ungültige YouTube-ID.");
    out.videoId = input.videoId;
  }
  if (input.url !== undefined) {
    if (typeof input.url !== "string" || input.url.length > 300 || !/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(input.url)) fail("Ungültige URL.");
    out.url = input.url;
  }
  if (input.engine !== undefined) {
    if (!ENGINES.has(input.engine as string)) fail("Unbekannte Engine.");
    out.engine = input.engine as Engine;
  }
  if (input.modelId !== undefined) {
    if (typeof input.modelId !== "string" || !/^[A-Za-z0-9._/:-]{1,80}$/.test(input.modelId)) fail("Ungültige Modell-ID.");
    out.modelId = input.modelId;
  }
  if (input.effort !== undefined) {
    if (!EFFORTS.has(input.effort as string)) fail("Ungültige Denkstufe.");
    out.effort = input.effort as Effort;
  }
  if (input.brandVoice !== undefined) {
    if (input.brandVoice !== "none" && input.brandVoice !== "chris") fail("Ungültige Brand Voice.");
    out.brandVoice = input.brandVoice;
  }
  return out;
}

function checkSize(value: unknown, label: string): number {
  if (!isFiniteNumber(value) || value < 40 || value > 20_000) fail(`${label} ist ungültig.`);
  return value;
}

export function checkNodeShape(value: unknown): NodeShape {
  const node = value as NodeShape;
  if (!node || typeof node !== "object") fail("Node fehlt.");
  if (!isNodeId(node.id)) fail("Ungültige Node-ID.");
  const type = nodeTypeOfId(node.id);
  if (!type || type !== node.type) fail("Node-Typ passt nicht zur ID.");
  if (node.parentId !== undefined && !isNodeId(node.parentId)) fail("Ungültige parentId.");
  if (node.type === "groupNode" && node.parentId !== undefined) fail("Gruppen können nicht in Gruppen liegen.");
  if (!Number.isInteger(node.zIndex) || Math.abs(node.zIndex) > 10_000) fail("Ungültiger zIndex.");
  return {
    id: node.id,
    type: node.type,
    position: checkPosition(node.position, "Node"),
    width: checkSize(node.width, "Breite"),
    height: checkSize(node.height, "Höhe"),
    zIndex: node.zIndex,
    ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
    data: checkData(node.data, false) as NodeData,
  };
}

function checkProvenance(value: unknown): Provenance | undefined {
  if (value === undefined) return undefined;
  const provenance = value as Provenance;
  if (!provenance || !Array.isArray(provenance.youtube) || !Array.isArray(provenance.texts) || provenance.youtube.length > 200 || provenance.texts.length > 500) fail("Ungültige Herkunft.");
  for (const entry of provenance.youtube) {
    if (typeof entry?.videoId !== "string" || typeof entry.versionId !== "string") fail("Ungültige Herkunft.");
  }
  for (const entry of provenance.texts) {
    if (typeof entry?.nodeId !== "string" || typeof entry.hash !== "string") fail("Ungültige Herkunft.");
  }
  return provenance;
}

function checkText(blocks: unknown, markdown: unknown): { blocks: string; markdown: string } {
  if (typeof blocks !== "string" || typeof markdown !== "string") fail("Text fehlt.");
  return { blocks, markdown };
}

function checkOpId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{6,80}$/.test(value)) fail("Ungültige opId.");
  return value;
}

/** Shape validation shared by the Next route and Convex. Budgets are checked by Convex. */
export function validateOp(value: unknown): Op {
  const op = value as Op & Record<string, unknown>;
  if (!op || typeof op !== "object" || !OP_TYPES.has(op.type)) fail("Unbekannte Op.");
  const opId = checkOpId(op.opId);
  switch (op.type) {
    case "node.create": {
      const node = checkNodeShape(op.node);
      const text = op.text === undefined ? undefined : { ...checkText(op.text.blocks, op.text.markdown), provenance: checkProvenance(op.text.provenance) };
      if (text && node.type !== "textNode") fail("Nur Text-Nodes tragen Text.");
      return { opId, type: op.type, node, ...(text ? { text } : {}) };
    }
    case "node.update": {
      if (!isNodeId(op.nodeId)) fail("Ungültige Node-ID.");
      const patch: NodePatch = {};
      const raw = (op.patch ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(raw)) if (!["position", "width", "height", "zIndex", "data"].includes(key)) fail(`Unbekanntes Feld ${key}.`);
      if (raw.position !== undefined) patch.position = checkPosition(raw.position, "Node");
      if (raw.width !== undefined) patch.width = checkSize(raw.width, "Breite");
      if (raw.height !== undefined) patch.height = checkSize(raw.height, "Höhe");
      if (raw.zIndex !== undefined) {
        if (!Number.isInteger(raw.zIndex)) fail("Ungültiger zIndex.");
        patch.zIndex = raw.zIndex as number;
      }
      if (raw.data !== undefined) patch.data = checkData(raw.data, true);
      if (Object.keys(patch).length === 0) fail("Leere Änderung.");
      return { opId, type: op.type, nodeId: op.nodeId, baseRev: checkRev(op.baseRev, "Node"), patch };
    }
    case "nodes.delete": {
      if (!Array.isArray(op.nodes) || op.nodes.length === 0 || op.nodes.length > LIMITS.nodesPerBoard) fail("Keine Nodes zum Löschen.");
      return { opId, type: op.type, nodes: op.nodes.map((entry) => ({ nodeId: isNodeId(entry?.nodeId) ? entry.nodeId : fail("Ungültige Node-ID."), baseRev: checkRev(entry.baseRev, "Node") })) };
    }
    case "nodes.restore":
      return { opId, type: op.type, deleteOpId: checkOpId(op.deleteOpId) };
    case "text.set": {
      if (!isNodeId(op.nodeId) || nodeTypeOfId(op.nodeId) !== "textNode") fail("Text nur an Text-Nodes.");
      return { opId, type: op.type, nodeId: op.nodeId, baseTextRev: checkRev(op.baseTextRev, "Text"), ...checkText(op.blocks, op.markdown), ...(op.provenance !== undefined ? { provenance: checkProvenance(op.provenance) } : {}) };
    }
    case "edge.create": {
      if (!isNodeId(op.source) || !isNodeId(op.target)) fail("Ungültige Kante.");
      const verdict = connectionVerdict(nodeTypeOfId(op.source), nodeTypeOfId(op.target), op.source, op.target);
      if (verdict) fail(verdict);
      return { opId, type: op.type, source: op.source, target: op.target };
    }
    case "edge.delete":
      if (typeof op.edgeId !== "string" || !op.edgeId.startsWith("xy-edge__") || op.edgeId.length > 200) fail("Ungültige Kanten-ID.");
      return { opId, type: op.type, edgeId: op.edgeId };
    case "group.create": {
      const group = checkNodeShape(op.group);
      if (group.type !== "groupNode") fail("Gruppe muss ein groupNode sein.");
      if (!Array.isArray(op.children) || op.children.length === 0 || op.children.length > LIMITS.nodesPerBoard) fail("Gruppe braucht Kinder.");
      const children = op.children.map((child) => ({ nodeId: isNodeId(child?.nodeId) ? child.nodeId : fail("Ungültige Node-ID."), baseRev: checkRev(child.baseRev, "Node"), position: checkPosition(child.position, "Kind") }));
      if (new Set(children.map((c) => c.nodeId)).size !== children.length) fail("Doppelte Kinder.");
      return { opId, type: op.type, group, children };
    }
    case "group.dissolve": {
      if (!isNodeId(op.groupId) || nodeTypeOfId(op.groupId) !== "groupNode") fail("Ungültige Gruppe.");
      if (!Array.isArray(op.children)) fail("Kinder fehlen.");
      const children = op.children.map((child) => ({ nodeId: isNodeId(child?.nodeId) ? child.nodeId : fail("Ungültige Node-ID."), baseRev: checkRev(child.baseRev, "Node"), position: checkPosition(child.position, "Kind") }));
      return { opId, type: op.type, groupId: op.groupId, baseRev: checkRev(op.baseRev, "Gruppe"), children };
    }
    case "board.update": {
      const patch = (op.patch ?? {}) as Record<string, unknown>;
      const out: { title?: string; brandVoiceText?: string; videoSlug?: string | null } = {};
      if (patch.title !== undefined) {
        if (typeof patch.title !== "string" || !patch.title.trim() || Array.from(patch.title).length > LIMITS.titleChars) fail("Titel muss 1 bis 200 Zeichen haben.");
        out.title = patch.title.trim();
      }
      if (patch.brandVoiceText !== undefined) {
        if (typeof patch.brandVoiceText !== "string" || utf8Bytes(patch.brandVoiceText) > LIMITS.promptBytes) fail("Brand Voice ist zu lang.");
        out.brandVoiceText = patch.brandVoiceText;
      }
      if (patch.videoSlug !== undefined) {
        if (patch.videoSlug !== null && (typeof patch.videoSlug !== "string" || !/^\d{2}-[a-z0-9-]+$/.test(patch.videoSlug))) fail("Ungültiger Video-Ordner.");
        out.videoSlug = patch.videoSlug as string | null;
      }
      if (Object.keys(out).length === 0) fail("Leere Änderung.");
      return { opId, type: op.type, patch: out };
    }
  }
  return fail("Unbekannte Op.");
}

/** Validate a whole batch: count, total size and each op. */
export function validateOps(value: unknown): Op[] {
  if (!Array.isArray(value) || value.length === 0) fail("Keine Ops.");
  if (value.length > LIMITS.opsPerBatch) fail(`Höchstens ${LIMITS.opsPerBatch} Ops je Anfrage.`);
  if (utf8Bytes(JSON.stringify(value)) > LIMITS.opsBatchBytes) fail("Ops-Paket ist zu groß.");
  return value.map(validateOp);
}

const SOURCE_TYPES: ReadonlySet<NodeType> = new Set(["youtubeNode", "textNode", "groupNode"]);

/**
 * Edge rule (point 31): YouTube, text or group to chat, `connector` to
 * `chat-connector`, no self edges. Returns a German reason or null.
 */
export function connectionVerdict(sourceType: NodeType | null, targetType: NodeType | null, source?: string, target?: string, sourceHandle = "connector", targetHandle = "chat-connector"): string | null {
  if (source !== undefined && source === target) return "Keine Kante auf sich selbst.";
  if (!sourceType || !SOURCE_TYPES.has(sourceType)) return "Nur YouTube, Text oder Gruppe können Quelle sein.";
  if (targetType !== "chatNode") return "Kanten führen nur zu einem Chat.";
  if (sourceHandle !== "connector" || targetHandle !== "chat-connector") return "Kante braucht die Anschlüsse connector und chat-connector.";
  return null;
}

export function makeEdge(source: string, target: string): BoardEdge {
  return { id: edgeId(source, target), source, target, sourceHandle: "connector", targetHandle: "chat-connector", type: "connectionEdge" };
}

/**
 * Geometry for grouping (point 62): the group wraps the bounding box of its
 * children plus padding; children get positions relative to the group.
 */
export function groupGeometry(children: Pick<NodeShape, "id" | "position" | "width" | "height">[]): { position: Position; width: number; height: number; childPositions: Record<string, Position> } {
  if (children.length === 0) throw new OpValidationError("Gruppe braucht Kinder.");
  const minX = Math.min(...children.map((c) => c.position.x));
  const minY = Math.min(...children.map((c) => c.position.y));
  const maxX = Math.max(...children.map((c) => c.position.x + c.width));
  const maxY = Math.max(...children.map((c) => c.position.y + c.height));
  const position = { x: minX - GROUP_PADDING.left, y: minY - GROUP_PADDING.top };
  const childPositions: Record<string, Position> = {};
  for (const child of children) childPositions[child.id] = { x: child.position.x - position.x, y: child.position.y - position.y };
  return { position, width: maxX - minX + GROUP_PADDING.left + GROUP_PADDING.right, height: maxY - minY + GROUP_PADDING.top + GROUP_PADDING.bottom, childPositions };
}

/** Absolute positions of the children when a group is dissolved. */
export function dissolveGeometry(group: Pick<NodeShape, "position">, children: Pick<NodeShape, "id" | "position">[]): Record<string, Position> {
  const out: Record<string, Position> = {};
  for (const child of children) out[child.id] = { x: child.position.x + group.position.x, y: child.position.y + group.position.y };
  return out;
}
