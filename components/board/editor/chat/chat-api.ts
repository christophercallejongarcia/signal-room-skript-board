"use client";

import { boardApi } from "@/lib/board/client";
import type { ContextManifest } from "@/lib/board/context";
import type { Effort, EngineId } from "@/lib/board/models";

/** Browser side of the chat routes (PLAN.md points 80 to 86). */

export type ActiveRun = { runId: string; state: "dispatching" | "running"; dispatcherId: string; generation: number; expiresAt: number } | null;

export type Conversation = { id: string; chatNodeId: string; title: string; activeRun: ActiveRun; createdAt: number; updatedAt: number };

export type ChatMessage = {
  id: string;
  conversationId: string;
  runId?: string;
  role: "user" | "assistant";
  text: string;
  truncated?: boolean;
  reasoning?: string;
  seq: number;
  status: "complete" | "streaming" | "aborted" | "error";
  terminal: boolean;
  engine?: EngineId;
  modelId?: string;
  promptId?: string;
  contextManifest?: ContextManifest;
  usage?: { inputTokens: number; outputTokens: number };
  error?: { code: string; message: string };
  createdAt: number;
  updatedAt: number;
};

export type EngineModel = { id: string; label: string; budgetTokens: number; isDefault: boolean; resolvedId?: string | null };

export type EngineStatus = {
  id: EngineId;
  label: string;
  streams: boolean;
  enabled: boolean;
  installed: boolean;
  loggedIn: boolean;
  available: boolean;
  reason: string | null;
  version: string | null;
  gate: { state: string; reason?: string };
  models: EngineModel[];
};

export type ContextPreview = {
  revision: number;
  sources: { nodeId: string; title: string; type: string; bytes: number }[];
  notReady: { videoId: string; status: string; title: string }[];
  estimatedTokens: number;
  budgetTokens: number;
  ok: boolean;
  brandVoice: { board: string; fallback: string };
};

export type ChatSettings = { engine: EngineId; modelId: string; effort: Effort; brandVoice: "none" | "chris" };

export const listConversations = (boardId: string, chatNodeId: string) =>
  boardApi<{ conversations: Conversation[] }>(`/chat/conversations?boardId=${encodeURIComponent(boardId)}&chatNodeId=${encodeURIComponent(chatNodeId)}`).then((result) => result.conversations);

export const listMessages = (conversationId: string, before?: number) =>
  boardApi<{ messages: ChatMessage[]; hasMore: boolean }>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages${before ? `?before=${before}` : ""}`);

export const renameConversation = (boardId: string, conversationId: string, title: string, restoreEpoch: number) =>
  boardApi(`/chat/conversations/${encodeURIComponent(conversationId)}`, { method: "PATCH", body: { boardId, title, restoreEpoch } });

export const deleteConversation = (boardId: string, conversationId: string, restoreEpoch: number) =>
  boardApi(`/chat/conversations/${encodeURIComponent(conversationId)}?boardId=${encodeURIComponent(boardId)}&restoreEpoch=${restoreEpoch}`, { method: "DELETE" });

export const stopRun = (runId: string) => boardApi<{ state: string }>(`/chat/${encodeURIComponent(runId)}/abort`, { method: "POST", body: {} });

let enginesCache: { at: number; value: Promise<EngineStatus[]> } | null = null;

export function loadEngines(fresh = false): Promise<EngineStatus[]> {
  if (!fresh && enginesCache && Date.now() - enginesCache.at < 60_000) return enginesCache.value;
  const value = boardApi<{ engines: EngineStatus[] }>(`/chat/engines${fresh ? "?fresh=1" : ""}`).then((result) => result.engines);
  enginesCache = { at: Date.now(), value };
  value.catch(() => (enginesCache = null));
  return value;
}

export const loadContext = (boardId: string, chatNodeId: string, settings: ChatSettings) =>
  boardApi<ContextPreview>(`/chat/context?boardId=${encodeURIComponent(boardId)}&chatNodeId=${encodeURIComponent(chatNodeId)}&engine=${settings.engine}&modelId=${encodeURIComponent(settings.modelId)}&brandVoice=${settings.brandVoice}`);

/** The error body of a refused send, parsed from the transport's error text. */
export type SendError = { status?: number; kind: string; error: string; [key: string]: unknown };

export function parseSendError(error: Error | undefined): SendError | null {
  if (!error) return null;
  try {
    const data = JSON.parse(error.message) as SendError;
    if (data && typeof data.error === "string") return { ...data, kind: typeof data.kind === "string" ? data.kind : "error" };
  } catch {
    // not JSON
  }
  return { kind: "error", error: error.message || "Senden fehlgeschlagen." };
}

const relative = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });

export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  if (Math.abs(seconds) < 45) return "gerade eben";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
}
