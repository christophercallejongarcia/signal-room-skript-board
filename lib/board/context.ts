import { CODEX_CONFIG_MODEL, isEffort, isEngineId, type Effort, type EngineId } from "./models.ts";
import { PROTOCOL_VERSION, isSupportedProtocolVersion } from "./versions.ts";

/**
 * Context contract between Next and the bridge (PLAN.md points 29, 82):
 * `BoardChatRequestV1`, its validator, and the builder that turns the edges
 * into a chat node into an ordered knowledge base plus a transitive manifest.
 * Order: by edge creation time; children of a group by position (top to bottom,
 * then left to right). The builder is pure; the caller brings the data from one
 * consistent Convex query and a hash function.
 */

export type KnowledgeItem = {
  id: string;
  type: "youtube" | "text";
  title: string;
  groupTitle?: string;
  url?: string;
  notes?: string;
  /** Transcript or Markdown text; empty for a YouTube source released "nur mit Titel". */
  transcript: string;
  titleOnly?: boolean;
};

export type ProvenanceYoutube = { videoId: string; versionId: string; title?: string; url?: string };
export type ProvenanceText = { nodeId: string; hash: string };
export type ContextManifest = { youtube: ProvenanceYoutube[]; texts: ProvenanceText[] };

export type ChatTurn = { role: "user" | "assistant"; parts: { type: "text"; text: string }[] };

export type BoardChatRequestV1 = {
  protocolVersion: number;
  runId: string;
  engine: EngineId;
  modelId: string;
  effort: Effort;
  knowledgeBase: KnowledgeItem[];
  brandVoice: string | null;
  messages: ChatTurn[];
  action: string | null;
  contextManifest: ContextManifest;
};

export const RUN_ID = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_SOURCES = 500;
const MAX_TURNS = 2_000;

export class ChatRequestError extends Error {
  status = 400;
}

function fail(message: string): never {
  throw new ChatRequestError(message);
}

function str(value: unknown, name: string, { optional = false, max = 5_000_000 } = {}): string | undefined {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    fail(`${name} fehlt.`);
  }
  if (typeof value !== "string") fail(`${name} muss Text sein.`);
  if (value.length > max) fail(`${name} ist zu lang.`);
  return value;
}

function parseManifest(value: unknown): ContextManifest {
  const input = (value ?? {}) as Record<string, unknown>;
  const youtube = Array.isArray(input.youtube) ? input.youtube : [];
  const texts = Array.isArray(input.texts) ? input.texts : [];
  return {
    youtube: youtube.map((entry, index) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      return {
        videoId: str(item.videoId, `contextManifest.youtube[${index}].videoId`, { max: 20 })!,
        versionId: str(item.versionId, `contextManifest.youtube[${index}].versionId`, { max: 200 })!,
        ...(typeof item.title === "string" ? { title: item.title.slice(0, 300) } : {}),
        ...(typeof item.url === "string" ? { url: item.url.slice(0, 300) } : {}),
      };
    }),
    texts: texts.map((entry, index) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      return { nodeId: str(item.nodeId, `contextManifest.texts[${index}].nodeId`, { max: 200 })!, hash: str(item.hash, `contextManifest.texts[${index}].hash`, { max: 200 })! };
    }),
  };
}

/** Validate an untrusted request body. Throws ChatRequestError with a German message. */
export function parseBoardChatRequest(input: unknown): BoardChatRequestV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Anfrage muss ein Objekt sein.");
  const body = input as Record<string, unknown>;
  if (!isSupportedProtocolVersion(body.protocolVersion)) {
    const error = new ChatRequestError("Nicht unterstützte protocolVersion. Board neu laden.");
    error.status = 409;
    throw error;
  }
  const runId = str(body.runId, "runId", { max: 100 })!;
  if (!RUN_ID.test(runId)) fail("Ungültige runId.");
  if (!isEngineId(body.engine)) fail("Unbekannte Engine.");
  const modelId = str(body.modelId, "modelId", { max: 100 })!;
  if (!/^[A-Za-z0-9._/:-]{1,100}$/.test(modelId)) fail("Ungültige modelId.");
  const effort = body.effort ?? "medium";
  if (!isEffort(effort)) fail("Ungültige Denkstufe.");
  if (!Array.isArray(body.knowledgeBase) || body.knowledgeBase.length > MAX_SOURCES) fail("knowledgeBase fehlt oder hat zu viele Quellen.");
  const knowledgeBase = body.knowledgeBase.map((entry, index): KnowledgeItem => {
    const item = (entry ?? {}) as Record<string, unknown>;
    if (item.type !== "youtube" && item.type !== "text") fail(`knowledgeBase[${index}].type ist ungültig.`);
    return {
      id: str(item.id, `knowledgeBase[${index}].id`, { max: 200 })!,
      type: item.type,
      title: str(item.title, `knowledgeBase[${index}].title`, { max: 1_000 })!,
      ...(item.groupTitle !== undefined && item.groupTitle !== null ? { groupTitle: str(item.groupTitle, `knowledgeBase[${index}].groupTitle`, { max: 1_000 }) } : {}),
      ...(item.url !== undefined && item.url !== null ? { url: str(item.url, `knowledgeBase[${index}].url`, { max: 2_000 }) } : {}),
      ...(item.notes !== undefined && item.notes !== null ? { notes: str(item.notes, `knowledgeBase[${index}].notes`, { max: 20_000 }) } : {}),
      transcript: str(item.transcript ?? "", `knowledgeBase[${index}].transcript`)!,
      ...(item.titleOnly === true ? { titleOnly: true } : {}),
    };
  });
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_TURNS) fail("messages fehlt oder ist zu lang.");
  const messages = body.messages.map((entry, index): ChatTurn => {
    const turn = (entry ?? {}) as Record<string, unknown>;
    if (turn.role !== "user" && turn.role !== "assistant") fail(`messages[${index}].role ist ungültig.`);
    if (!Array.isArray(turn.parts) || turn.parts.length === 0) fail(`messages[${index}].parts fehlt.`);
    return {
      role: turn.role,
      parts: turn.parts.map((part, partIndex) => {
        const value = (part ?? {}) as Record<string, unknown>;
        if (value.type !== "text") fail(`messages[${index}].parts[${partIndex}] ist kein Text.`);
        return { type: "text" as const, text: str(value.text, `messages[${index}].parts[${partIndex}].text`)! };
      }),
    };
  });
  if (messages.at(-1)?.role !== "user") fail("Die letzte Nachricht muss von Chris kommen.");
  const brandVoice = str(body.brandVoice, "brandVoice", { optional: true, max: 50_000 }) ?? null;
  const action = str(body.action, "action", { optional: true, max: 200 }) ?? null;
  return {
    protocolVersion: body.protocolVersion as number,
    runId,
    engine: body.engine,
    modelId: body.engine === "codex" ? modelId || CODEX_CONFIG_MODEL : modelId,
    effort,
    knowledgeBase,
    brandVoice: brandVoice?.trim() ? brandVoice : null,
    messages,
    action,
    contextManifest: parseManifest(body.contextManifest),
  };
}

// ---------------------------------------------------------------------------
// Builder (Phase 5): edges → ordered knowledge base and transitive manifest

export type ContextNode = {
  id: string;
  type: "youtubeNode" | "textNode" | "groupNode" | "chatNode";
  title: string;
  notes?: string;
  parentId?: string;
  position: { x: number; y: number };
  videoId?: string;
  url?: string;
};

export type ContextEdge = { source: string; target: string; createdAt: number };

export type ContextText = { markdown: string; provenance?: ContextManifest | null };

export type ContextTranscript = { status: string; versionId?: string; text?: string; title?: string };

export type ContextInput = {
  chatNodeId: string;
  nodes: ContextNode[];
  edges: ContextEdge[];
  texts: Record<string, ContextText | undefined>;
  transcripts: Record<string, ContextTranscript | undefined>;
  /** Video IDs Chris released "nur mit Titel" for this message. */
  titleOnly?: string[];
  hashText: (text: string) => string;
};

export type ConnectedSource = { node: ContextNode; groupTitle?: string };

export type ContextResult = {
  knowledgeBase: KnowledgeItem[];
  contextManifest: ContextManifest;
  /** YouTube sources whose transcript is not ready and not released title-only (point 72). */
  blocked: { nodeId: string; videoId?: string; title: string; status: string }[];
  sources: { nodeId: string; title: string; type: "youtube" | "text"; bytes: number }[];
};

const byPosition = (a: ContextNode, b: ContextNode) => a.position.y - b.position.y || a.position.x - b.position.x;

/** Sources connected to the chat node, groups expanded to their children, each node once. */
export function connectedSources(chatNodeId: string, nodes: ContextNode[], edges: ContextEdge[]): ConnectedSource[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const result: ConnectedSource[] = [];
  const incoming = edges.filter((edge) => edge.target === chatNodeId).sort((a, b) => a.createdAt - b.createdAt || a.source.localeCompare(b.source));
  const add = (node: ContextNode, groupTitle?: string) => {
    if (seen.has(node.id) || (node.type !== "youtubeNode" && node.type !== "textNode")) return;
    seen.add(node.id);
    result.push(groupTitle === undefined ? { node } : { node, groupTitle });
  };
  for (const edge of incoming) {
    const source = byId.get(edge.source);
    if (!source) continue;
    if (source.type === "groupNode") {
      const children = nodes.filter((node) => node.parentId === source.id).sort(byPosition);
      for (const child of children) add(child, source.title || "Gruppe");
    } else add(source);
  }
  return result;
}

function utf8(text: string) {
  return new TextEncoder().encode(text).length;
}

function pushUnique<T>(list: T[], item: T, key: (value: T) => string) {
  if (!list.some((existing) => key(existing) === key(item))) list.push(item);
}

export function buildContext(input: ContextInput): ContextResult {
  const titleOnly = new Set(input.titleOnly ?? []);
  const knowledgeBase: KnowledgeItem[] = [];
  const manifest: ContextManifest = { youtube: [], texts: [] };
  const blocked: ContextResult["blocked"] = [];
  const sources: ContextResult["sources"] = [];
  const ytKey = (entry: ProvenanceYoutube) => `${entry.videoId}:${entry.versionId}`;
  const textKey = (entry: ProvenanceText) => `${entry.nodeId}:${entry.hash}`;

  for (const { node, groupTitle } of connectedSources(input.chatNodeId, input.nodes, input.edges)) {
    const base = {
      id: node.id,
      title: node.title,
      ...(groupTitle !== undefined ? { groupTitle } : {}),
      ...(node.notes?.trim() ? { notes: node.notes } : {}),
    };
    if (node.type === "youtubeNode") {
      const transcript = node.videoId ? input.transcripts[node.videoId] : undefined;
      const url = node.url ?? (node.videoId ? `https://www.youtube.com/watch?v=${node.videoId}` : undefined);
      const title = node.title || transcript?.title || "YouTube-Video";
      if (transcript?.status === "ready" && transcript.versionId && typeof transcript.text === "string") {
        knowledgeBase.push({ ...base, title, type: "youtube", ...(url ? { url } : {}), transcript: transcript.text });
        pushUnique(manifest.youtube, { videoId: node.videoId!, versionId: transcript.versionId, title, ...(url ? { url } : {}) }, ytKey);
        sources.push({ nodeId: node.id, title, type: "youtube", bytes: utf8(transcript.text) });
      } else if (node.videoId && titleOnly.has(node.videoId)) {
        knowledgeBase.push({ ...base, title, type: "youtube", ...(url ? { url } : {}), transcript: "", titleOnly: true });
        sources.push({ nodeId: node.id, title, type: "youtube", bytes: 0 });
      } else {
        blocked.push({ nodeId: node.id, ...(node.videoId ? { videoId: node.videoId } : {}), title, status: transcript?.status ?? "missing" });
      }
    } else {
      const text = input.texts[node.id];
      const markdown = text?.markdown ?? "";
      knowledgeBase.push({ ...base, title: node.title || "Text", type: "text", transcript: markdown });
      pushUnique(manifest.texts, { nodeId: node.id, hash: input.hashText(markdown) }, textKey);
      for (const entry of text?.provenance?.youtube ?? []) pushUnique(manifest.youtube, entry, ytKey);
      for (const entry of text?.provenance?.texts ?? []) pushUnique(manifest.texts, entry, textKey);
      sources.push({ nodeId: node.id, title: node.title || "Text", type: "text", bytes: utf8(markdown) });
    }
  }
  return { knowledgeBase, contextManifest: manifest, blocked, sources };
}

// ---------------------------------------------------------------------------
// Mentions (point 84)

const MENTION = /<poppy_reference_node\s+nodeId="([^"]*)"[^>]*\/>/g;

export function mentionedNodeIds(text: string): string[] {
  return [...text.matchAll(MENTION)].map((match) => match[1]);
}

/** Node IDs mentioned in `text` that are not among the connected sources. */
export function staleMentions(text: string, connectedIds: Iterable<string>): string[] {
  const allowed = new Set(connectedIds);
  return mentionedNodeIds(text).filter((id) => !allowed.has(id));
}

export function mentionTag(node: { id: string; title: string; type: string }): string {
  const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<poppy_reference_node nodeId="${attr(node.id)}" title="${attr(node.title)}" type="${attr(node.type)}" />`;
}

export function newRequestShell(runId: string): Pick<BoardChatRequestV1, "protocolVersion" | "runId"> {
  return { protocolVersion: PROTOCOL_VERSION, runId };
}
