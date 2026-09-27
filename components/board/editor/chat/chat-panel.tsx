"use client";

import { useChat } from "@ai-sdk/react";
import { ArrowUp, Brain, CaretDown, ChatCircleDots, Check, CopySimple, DotsThree, NotePencil, PencilSimple, Plus, SidebarSimple, Stop, TextT, Trash, Warning } from "@phosphor-icons/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { answerTitle, answerToMarkdown } from "@/lib/board/answer";
import { csrfToken } from "@/lib/board/client";
import { staleMentions } from "@/lib/board/context";
import { newOpaqueId } from "@/lib/board/ids";
import { CODEX_CONFIG_MODEL, DEFAULT_CHAT_SETTINGS, EFFORT_LABELS, EFFORTS, modelLabel, type Effort, type EngineId } from "@/lib/board/models";
import { useEditor } from "../context";
import { useSources } from "../sources";
import {
  deleteConversation,
  formatBytes,
  listConversations,
  listMessages,
  loadContext,
  loadEngines,
  parseSendError,
  relativeTime,
  renameConversation,
  stopRun,
  type ChatMessage,
  type ChatSettings,
  type ContextPreview,
  type Conversation,
  type EngineStatus,
  type SendError,
} from "./chat-api";
import { ChatInput, TYPE_LABEL, type ChatInputHandle, type Mentionable } from "./chat-input";
import { ChatMarkdown, mentionsToMarkdown } from "./chat-markdown";

/**
 * The chat node's inside (PLAN.md points 80 to 86): conversations on the left,
 * messages and input on the right. History comes from Convex; the answer in
 * flight streams through `useChat`. A send always waits until the board is
 * saved and carries the confirmed revision (point 32).
 */

type RunData = { runId: string; conversationId: string; follow?: boolean; conversationCreated?: boolean };

const POLL_MS = 2_000;

function newConversationId() {
  return newOpaqueId("conv");
}

export default function ChatPanel({ nodeId, selected }: { nodeId: string; selected: boolean }) {
  const { session, snapshot, actions } = useEditor();
  const { sources } = useSources();
  const node = snapshot.model.nodes.get(nodeId);
  const boardId = snapshot.meta?.id ?? "";
  const writable = snapshot.writable;
  const settings: ChatSettings = {
    engine: (node?.data.engine ?? DEFAULT_CHAT_SETTINGS.engine) as EngineId,
    modelId: node?.data.modelId ?? DEFAULT_CHAT_SETTINGS.modelId,
    effort: (node?.data.effort ?? DEFAULT_CHAT_SETTINGS.effort) as Effort,
    brandVoice: node?.data.brandVoice ?? "chris",
  };

  const [sidebar, setSidebar] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>(() => newConversationId());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [engines, setEngines] = useState<EngineStatus[] | null>(null);
  const [context, setContext] = useState<ContextPreview | null>(null);
  const [titleOnly, setTitleOnly] = useState<Set<string>>(new Set());
  const [sendError, setSendError] = useState<SendError | null>(null);
  const [following, setFollowing] = useState<string | null>(null);
  const [inputEmpty, setInputEmpty] = useState(true);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Conversation | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const input = useRef<ChatInputHandle>(null);
  const lastError = useRef<Error | null>(null);
  const currentRun = useRef<RunData | null>(null);
  const listEnd = useRef<HTMLDivElement>(null);
  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;

  // ---------- data ----------

  const refreshConversations = useCallback(async () => {
    if (!boardId) return;
    try {
      setConversations(await listConversations(boardId, nodeId));
    } catch {
      // offline: keep the list
    }
  }, [boardId, nodeId]);

  const refreshMessages = useCallback(async (conversationId = activeId) => {
    try {
      const result = await listMessages(conversationId);
      setMessages((current) => (conversationId === activeId || current.length === 0 ? result.messages : current));
      setHasMore(result.hasMore);
      return result.messages;
    } catch {
      return null;
    }
  }, [activeId]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Open the newest conversation once the list arrives, unless Chris already started a new one.
  const openedFirst = useRef(false);
  useEffect(() => {
    if (openedFirst.current || conversations.length === 0) return;
    openedFirst.current = true;
    if (messages.length === 0) setActiveId(conversations[0].id);
  }, [conversations, messages.length]);

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    void refreshMessages(activeId);
  }, [activeId, refreshMessages]);

  // Engines: once, and fresh when the dropdown opens.
  useEffect(() => {
    void loadEngines().then(setEngines, () => setEngines([]));
  }, []);

  // Context display: sources, bytes and estimate, refreshed when edges, sources or settings change.
  const edgeKey = useMemo(() => {
    const incoming = [...snapshot.model.edges.values()].filter((edge) => edge.target === nodeId).map((edge) => edge.source);
    const groups = new Set(incoming.filter((id) => snapshot.model.nodes.get(id)?.type === "groupNode"));
    const children = [...snapshot.model.nodes.values()].filter((entry) => entry.parentId && groups.has(entry.parentId)).map((entry) => `${entry.id}:${entry.rev}`);
    return [...incoming.map((id) => `${id}:${snapshot.model.nodes.get(id)?.rev ?? 0}`), ...children].sort().join(",");
  }, [snapshot.model, nodeId]);
  const sourceKey = [...sources.values()].map((source) => `${source.videoId}:${source.transcriptStatus}`).join(",");
  useEffect(() => {
    if (!boardId) return;
    const timer = setTimeout(() => {
      void loadContext(boardId, nodeId, settings).then(setContext, () => {});
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, nodeId, edgeKey, sourceKey, settings.engine, settings.modelId, settings.brandVoice, snapshot.meta?.brandVoiceText]);

  // ---------- mentions (point 84) ----------

  const mentionables: Mentionable[] = useMemo(() => {
    const model = snapshot.model;
    const counters: Record<string, number> = {};
    const label = (id: string) => {
      const entry = model.nodes.get(id);
      if (!entry || entry.type === "chatNode") return null;
      const title = session.titleFor(id).trim();
      counters[entry.type] = (counters[entry.type] ?? 0) + (title ? 0 : 1);
      return { id, type: entry.type as Mentionable["type"], title: title || `${TYPE_LABEL[entry.type as Mentionable["type"]]} ${counters[entry.type]}` };
    };
    const out: Mentionable[] = [];
    for (const edge of model.edges.values()) {
      if (edge.target !== nodeId) continue;
      const source = label(edge.source);
      if (!source) continue;
      out.push(source);
      if (source.type === "groupNode") {
        // Children in the same order as in the context: top to bottom, then left to right.
        const children = [...model.nodes.values()].filter((child) => child.parentId === source.id).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
        for (const child of children) {
          const entry = label(child.id);
          if (entry) out.push(entry);
        }
      }
    }
    return out;
  }, [snapshot.model, nodeId, session]);

  // ---------- streaming ----------

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/board/chat",
        credentials: "same-origin",
        headers: () => ({ "x-board-csrf": csrfToken() }),
        prepareSendMessagesRequest: ({ body }) => ({ body: body ?? {} }),
      }),
    [],
  );
  const chat = useChat({
    id: `chat-${nodeId}`,
    transport,
    onError: (error) => {
      lastError.current = error;
    },
    onData: (part) => {
      if (part.type !== "data-run") return;
      const data = part.data as RunData;
      currentRun.current = data;
      input.current?.clear();
      setTitleOnly(new Set());
      if (data.follow) setFollowing(data.runId);
      if (data.conversationCreated) void refreshConversations();
    },
  });
  const streaming = chat.status === "submitted" || chat.status === "streaming";

  // After a run: the answer is in Convex, the local copy goes.
  const settle = useCallback(async () => {
    await refreshMessages();
    await refreshConversations();
    chat.setMessages([]);
  }, [chat, refreshConversations, refreshMessages]);

  // Follow runs that this tab does not stream: a retry, a reload in the middle, another tab.
  const pendingRun = messages.some((message) => message.role === "assistant" && !message.terminal);
  useEffect(() => {
    if (streaming || (!pendingRun && !following)) return;
    const timer = setInterval(async () => {
      const fresh = await refreshMessages();
      if (fresh && !fresh.some((message) => message.role === "assistant" && !message.terminal)) {
        setFollowing(null);
        void refreshConversations();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [streaming, pendingRun, following, refreshMessages, refreshConversations]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end" });
  }, [messages.length, chat.messages]);

  const blockedSources = (context?.notReady ?? []).filter((source) => !titleOnly.has(source.videoId));
  const engineStatus = engines?.find((entry) => entry.id === settings.engine);
  const engineBlocked = engines !== null && engineStatus !== undefined && !engineStatus.available;

  const send = useCallback(
    async (options: { text?: string; historyTurns?: number; allowAllTitleOnly?: boolean } = {}) => {
      const text = options.text ?? input.current?.serialize() ?? "";
      if (!text.trim() || streaming || !writable || !boardId) return;
      setSendError(null);
      const stale = staleMentions(text, mentionables.map((entry) => entry.id));
      if (stale.length > 0) {
        setSendError({ kind: "stale-mention", error: "Die Nachricht erwähnt eine Quelle, die nicht mehr verbunden ist. Erwähnung entfernen oder Quelle wieder verbinden." });
        return;
      }
      if (context && !context.ok && options.historyTurns === undefined) return;
      const allowTitleOnly = options.allowAllTitleOnly ? (context?.notReady ?? []).map((entry) => entry.videoId) : [...titleOnly];
      if (!options.allowAllTitleOnly && blockedSources.length > 0) {
        setSendError({ kind: "sources-not-ready", error: "Nicht alle verbundenen Quellen sind fertig.", sources: blockedSources });
        return;
      }
      try {
        await session.flush();
      } catch {
        setSendError({ kind: "save", error: "Speichern fehlgeschlagen. Senden ist gesperrt, bis das Board gespeichert ist." });
        return;
      }
      if (!session.writable || snapshot.saveState === "localfail") {
        setSendError({ kind: "save", error: "Speichern fehlgeschlagen. Senden ist gesperrt, bis das Board gespeichert ist." });
        return;
      }
      const runId = newOpaqueId("run");
      currentRun.current = { runId, conversationId: activeId };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        lastError.current = null;
        const body = {
          runId,
          boardId,
          boardRevision: session.meta?.revision ?? 0,
          restoreEpoch: session.meta?.restoreEpoch ?? 1,
          chatNodeId: nodeId,
          conversationId: activeId,
          text,
          engine: settings.engine,
          modelId: settings.engine === "codex" ? CODEX_CONFIG_MODEL : settings.modelId,
          effort: settings.effort,
          brandVoice: settings.brandVoice,
          allowTitleOnly,
          ...(options.historyTurns !== undefined ? { historyTurns: options.historyTurns } : {}),
        };
        await chat.sendMessage({ text: mentionsToMarkdown(text) }, { body });
        const error = parseSendError(lastError.current ?? undefined);
        if (!error) break;
        if (error.kind === "revision" && attempt === 0) {
          // Point 32: flush once more and retry with the same runId (nothing was created yet).
          try {
            await session.flush();
          } catch {
            setSendError({ kind: "save", error: "Speichern fehlgeschlagen. Senden ist gesperrt." });
            break;
          }
          chat.setMessages([]);
          continue;
        }
        chat.setMessages([]);
        setSendError({ ...error, error: error.kind === "revision" ? "Board hat sich geändert, bitte erneut senden." : error.error });
        break;
      }
      await settle();
    },
    [streaming, writable, boardId, mentionables, context, titleOnly, blockedSources, session, snapshot.saveState, activeId, nodeId, settings, chat, settle],
  );

  const stop = useCallback(async (runIdOverride?: string) => {
    const runId =
      runIdOverride ??
      (streaming ? currentRun.current?.runId : undefined) ??
      active?.activeRun?.runId ??
      [...messages].reverse().find((message) => message.role === "assistant" && !message.terminal)?.runId;
    if (!runId) return;
    try {
      await stopRun(runId);
    } catch (error) {
      setSendError({ kind: "stop", error: error instanceof Error ? error.message : "Stoppen fehlgeschlagen." });
    }
    setTimeout(() => void refreshMessages(), 500);
  }, [active, messages, refreshMessages, streaming]);

  const resend = useCallback(
    (assistant: ChatMessage) => {
      const index = messages.findIndex((message) => message.id === assistant.id);
      const user = [...messages.slice(0, index)].reverse().find((message) => message.role === "user");
      if (user) void send({ text: user.text });
    },
    [messages, send],
  );

  // ---------- actions ----------

  const updateSettings = (patch: Partial<ChatSettings>) => void session.setNodeData(nodeId, patch);

  const newConversation = () => {
    setActiveId(newConversationId());
    setMessages([]);
    chat.setMessages([]);
    setSendError(null);
    input.current?.focus();
  };

  const copy = async (message: ChatMessage) => {
    await navigator.clipboard.writeText(message.text).catch(() => {});
    setCopied(message.id);
    setTimeout(() => setCopied(null), 1_500);
  };

  const asTextNode = async (message: ChatMessage) => {
    const markdown = answerToMarkdown(message.text);
    await actions.createAnswerNode(nodeId, { title: answerTitle(markdown), markdown, provenance: message.contextManifest });
  };

  const liveMessages = chat.messages.filter((message) => !messages.some((stored) => stored.runId && message.id === `${stored.runId}-a`));
  const claimLapsed = (message: ChatMessage) => !message.terminal && !streaming && following !== message.runId && (!active?.activeRun || active.activeRun.runId !== message.runId || active.activeRun.expiresAt < Date.now());

  // Point 42: over the budget, sending is blocked right away with both offers.
  const budgetBlock: SendError | null =
    context && !context.ok
      ? { kind: "budget", error: `Kontext zu groß für dieses Modell: geschätzt ${context.estimatedTokens.toLocaleString("de-DE")} von ${context.budgetTokens.toLocaleString("de-DE")} Tokens.`, sources: context.sources }
      : null;
  const banner = sendError ?? budgetBlock;

  if (!node) return null;
  return (
    <div className="bd-chat nodrag nowheel nopan" data-chat-node={nodeId}>
      {sidebar ? (
        <aside className="bd-chat-side">
          <button type="button" className="bd-chat-side-button" onClick={() => setSidebar(false)}>
            <SidebarSimple size={16} /> Seitenleiste schließen
          </button>
          <button type="button" className="bd-chat-side-button bd-chat-side-button--accent" onClick={newConversation}>
            <Plus size={16} /> Neue Unterhaltung
          </button>
          {conversations.length > 0 ? <div className="bd-chat-side-label">Unterhaltungen</div> : null}
          <ul className="bd-chat-conversations" aria-label="Unterhaltungen">
            {conversations.map((conversation) => (
              <li key={conversation.id} className={`bd-chat-conversation${conversation.id === activeId ? " is-active" : ""}`}>
                {renaming?.id === conversation.id ? (
                  <input
                    className="bd-input bd-chat-rename nokey"
                    autoFocus
                    value={renaming.value}
                    aria-label="Unterhaltung umbenennen"
                    maxLength={200}
                    onChange={(event) => setRenaming({ id: conversation.id, value: event.target.value })}
                    onBlur={async () => {
                      const value = renaming.value.trim();
                      setRenaming(null);
                      if (value && value !== conversation.title) {
                        await renameConversation(boardId, conversation.id, value, session.meta?.restoreEpoch ?? 1).catch(() => {});
                        void refreshConversations();
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                      if (event.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <button type="button" className="bd-chat-conversation-title" onClick={() => setActiveId(conversation.id)} title={conversation.title}>
                    {conversation.title}
                  </button>
                )}
                <button type="button" className="bd-chat-conversation-menu" aria-label={`Optionen für ${conversation.title}`} onClick={() => setMenuFor(menuFor === conversation.id ? null : conversation.id)}>
                  <DotsThree size={16} weight="bold" />
                </button>
                {menuFor === conversation.id ? (
                  <div className="bd-chat-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => (setMenuFor(null), setRenaming({ id: conversation.id, value: conversation.title }))} disabled={!writable}>
                      <PencilSimple size={14} /> Umbenennen
                    </button>
                    <button type="button" role="menuitem" className="bd-danger-text" onClick={() => (setMenuFor(null), setConfirmDelete(conversation))} disabled={!writable}>
                      <Trash size={14} /> Löschen
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
      <section className="bd-chat-main">
        {!sidebar ? (
          <button type="button" className="bd-chat-side-toggle" aria-label="Seitenleiste öffnen" onClick={() => setSidebar(true)}>
            <SidebarSimple size={16} />
          </button>
        ) : null}
        {(context?.notReady.length ?? 0) > 0 ? (
          <div className="bd-chat-warning" role="status" data-testid="chat-sources-warning">
            <Warning size={16} weight="fill" />
            <div>
              {context!.notReady.map((source) => (
                <label key={source.videoId} className="bd-chat-warning-row">
                  <span>
                    {source.title}: {source.status === "pending" || source.status === "apify-pending" ? "Transkript lädt noch" : source.status === "no-captions" ? "keine Untertitel" : "Transkript fehlt"}
                  </span>
                  <input
                    type="checkbox"
                    checked={titleOnly.has(source.videoId)}
                    onChange={(event) =>
                      setTitleOnly((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(source.videoId);
                        else next.delete(source.videoId);
                        return next;
                      })
                    }
                  />
                  <span className="bd-muted">nur mit Titel</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <div className="bd-chat-messages" data-testid="chat-messages">
          {hasMore ? (
            <button
              type="button"
              className="bd-button bd-button--ghost bd-chat-older"
              onClick={async () => {
                const older = await listMessages(activeId, messages[0]?.createdAt);
                setMessages((current) => [...older.messages, ...current]);
                setHasMore(older.hasMore);
              }}
            >
              Ältere laden
            </button>
          ) : null}
          {messages.length === 0 && liveMessages.length === 0 ? (
            <div className="bd-chat-empty">
              <ChatCircleDots size={28} />
              <p>{mentionables.length === 0 ? "Zieh eine Linie von einer Quelle hierher und frag los." : `${mentionables.length} ${mentionables.length === 1 ? "Quelle" : "Quellen"} verbunden. Frag los.`}</p>
            </div>
          ) : null}
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="bd-chat-msg bd-chat-msg--user" data-message-id={message.id}>
                <ChatMarkdown text={mentionsToMarkdown(message.text)} />
              </div>
            ) : (
              <div key={message.id} className={`bd-chat-msg bd-chat-msg--assistant bd-chat-msg--${message.status}`} data-message-id={message.id} data-status={message.status} data-terminal={message.terminal ? "true" : "false"}>
                {message.text ? <ChatMarkdown text={message.text} /> : !message.terminal ? <p className="bd-chat-thinking">{message.engine === "codex" ? "Codex denkt … (die Antwort kommt am Stück)" : "denkt …"}</p> : null}
                {message.truncated ? <p className="bd-muted">Antwort gekürzt (über 200 KB).</p> : null}
                {message.status === "error" ? (
                  <p className="bd-chat-error" role="alert">
                    {message.error?.message ?? "Die Engine hat mit einem Fehler geantwortet."}
                  </p>
                ) : null}
                {message.status === "aborted" ? <p className="bd-muted">{message.error?.code === "interrupted" ? "Unterbrochen." : "Abgebrochen."}</p> : null}
                {!message.terminal && claimLapsed(message) ? <p className="bd-muted" data-testid="run-interrupted">Unterbrochen: Warte auf den Abschluss …</p> : null}
                <div className="bd-chat-meta">
                  <span>
                    {message.engine ? modelLabel(message.engine, message.modelId) : "Antwort"} · {relativeTime(message.updatedAt)}
                  </span>
                  <span className="bd-chat-actions">
                    {message.status === "error" || message.status === "aborted" ? (
                      <button type="button" onClick={() => resend(message)} disabled={streaming || !writable}>
                        Erneut senden
                      </button>
                    ) : null}
                    {message.text ? (
                      <>
                        <button type="button" onClick={() => void copy(message)} aria-label="Kopieren">
                          {copied === message.id ? <Check size={14} /> : <CopySimple size={14} />} {copied === message.id ? "Kopiert" : "Kopieren"}
                        </button>
                        <button type="button" onClick={() => void asTextNode(message)} disabled={!writable || !message.terminal}>
                          <TextT size={14} /> Als Text-Node
                        </button>
                      </>
                    ) : null}
                  </span>
                </div>
              </div>
            ),
          )}
          {liveMessages.map((message) => {
            const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
            const reasoning = message.parts.some((part) => part.type === "reasoning");
            return message.role === "user" ? (
              <div key={message.id} className="bd-chat-msg bd-chat-msg--user bd-chat-msg--live">
                <ChatMarkdown text={text} />
              </div>
            ) : (
              <div key={message.id} className="bd-chat-msg bd-chat-msg--assistant bd-chat-msg--live" data-status="streaming">
                {text ? <ChatMarkdown text={text} /> : <p className="bd-chat-thinking">{settings.engine === "codex" ? "Codex denkt … (die Antwort kommt am Stück)" : reasoning ? "denkt nach …" : "denkt …"}</p>}
                <div className="bd-chat-meta">
                  <span>{modelLabel(settings.engine, settings.engine === "codex" ? undefined : settings.modelId)} · schreibt …</span>
                </div>
              </div>
            );
          })}
          {streaming && liveMessages.every((message) => message.role === "user") ? <p className="bd-chat-thinking">sendet …</p> : null}
          <div ref={listEnd} />
        </div>
        {banner ? <SendErrorBanner error={banner} onClose={() => setSendError(null)} onTitleOnly={() => void send({ allowAllTitleOnly: true })} onShortHistory={() => void send({ historyTurns: 4 })} onStop={() => void stop(typeof banner.activeRunId === "string" ? banner.activeRunId : undefined)} onDisconnect={(nodeIdToCut) => cutSource(nodeIdToCut)} /> : null}
        <div className={`bd-chat-composer${selected ? " is-selected" : ""}`}>
          <ChatInput ref={input} mentionables={mentionables} disabled={!writable} placeholder="Frag etwas, @ für Quellen" onSubmit={() => void send()} onChange={setInputEmpty} />
          <div className="bd-chat-toolbar">
            <BrandMenu value={settings.brandVoice} onChange={(brandVoice) => updateSettings({ brandVoice })} boardText={snapshot.meta?.brandVoiceText ?? ""} fallback={context?.brandVoice.fallback ?? ""} onSave={(text) => void session.setBrandVoice(text)} disabled={!writable} />
            <ContextBar context={context} />
            <div className="bd-chat-toolbar-spacer" />
            <ModelMenu settings={settings} engines={engines} onRefresh={async () => setEngines(await loadEngines(true).catch(() => []))} onChange={updateSettings} disabled={!writable} />
            {streaming || (pendingRun && !messages.at(-1)?.terminal) ? (
              <button type="button" className="bd-chat-send bd-chat-send--stop" onClick={() => void stop()} aria-label="Stopp">
                <Stop size={16} weight="fill" />
              </button>
            ) : (
              <button type="button" className="bd-chat-send" onClick={() => void send()} disabled={!writable || inputEmpty || engineBlocked || (context !== null && !context.ok)} aria-label="Senden" title={engineBlocked ? (engineStatus?.reason ?? undefined) : undefined}>
                <ArrowUp size={16} weight="bold" />
              </button>
            )}
          </div>
          {engineBlocked ? <p className="bd-chat-hint bd-chat-hint--warn">{engineStatus?.label}: {engineStatus?.reason}</p> : null}
        </div>
      </section>
      {confirmDelete ? (
        <ConfirmDialog
          title="Unterhaltung löschen?"
          text={`„${confirmDelete.title}" wird gelöscht.`}
          confirmLabel="Löschen"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const target = confirmDelete;
            setConfirmDelete(null);
            try {
              await deleteConversation(boardId, target.id, session.meta?.restoreEpoch ?? 1);
              if (target.id === activeId) newConversation();
            } catch (error) {
              setSendError({ kind: "delete", error: error instanceof Error ? error.message : "Löschen fehlgeschlagen." });
            }
            void refreshConversations();
          }}
        />
      ) : null}
    </div>
  );

  function cutSource(sourceId: string) {
    const model = session.model;
    const target = model.nodes.get(sourceId);
    // A group child is fed through its group's edge.
    const edgeSource = target?.parentId && ![...model.edges.values()].some((edge) => edge.source === sourceId && edge.target === nodeId) ? target.parentId : sourceId;
    const edge = [...model.edges.values()].find((entry) => entry.source === edgeSource && entry.target === nodeId);
    if (edge) actions.deleteEdge(edge.id);
    setSendError(null);
  }
}

function SendErrorBanner({ error, onClose, onTitleOnly, onShortHistory, onStop, onDisconnect }: { error: SendError; onClose(): void; onTitleOnly(): void; onShortHistory(): void; onStop(): void; onDisconnect(nodeId: string): void }) {
  const sources = Array.isArray(error.sources) ? (error.sources as { nodeId?: string; videoId?: string; title: string; bytes?: number; status?: string }[]) : [];
  return (
    <div className="bd-chat-send-error" role="alert" data-kind={error.kind}>
      <div className="bd-chat-send-error-head">
        <Warning size={16} weight="fill" />
        <span>{error.error}</span>
        <button type="button" className="bd-button bd-button--ghost" onClick={onClose}>
          Schließen
        </button>
      </div>
      {error.kind === "budget" ? (
        <div className="bd-chat-send-error-body">
          <p>Größte Quellen trennen oder den Verlauf kürzen:</p>
          <ul>
            {sources.slice(0, 6).map((source) => (
              <li key={source.nodeId}>
                {source.title} · {formatBytes(source.bytes ?? 0)}
                <button type="button" className="bd-button bd-button--ghost" onClick={() => source.nodeId && onDisconnect(source.nodeId)}>
                  Trennen
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="bd-button" onClick={onShortHistory}>
            Verlauf kürzen (letzte 4 Wendungen)
          </button>
        </div>
      ) : null}
      {error.kind === "sources-not-ready" ? (
        <div className="bd-chat-send-error-body">
          <ul>
            {sources.map((source) => (
              <li key={source.videoId ?? source.nodeId}>{source.title}</li>
            ))}
          </ul>
          <button type="button" className="bd-button" onClick={onTitleOnly}>
            Nur mit Titel senden
          </button>
        </div>
      ) : null}
      {error.kind === "run-active" ? (
        <div className="bd-chat-send-error-body">
          <button type="button" className="bd-button" onClick={onStop}>
            <Stop size={14} /> Stoppen
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ContextBar({ context }: { context: ContextPreview | null }) {
  const [open, setOpen] = useState(false);
  if (!context) return <span className="bd-chat-context bd-muted">Kontext …</span>;
  const bytes = context.sources.reduce((sum, source) => sum + source.bytes, 0);
  return (
    <span className="bd-chat-context-wrap">
      <button type="button" className={`bd-chat-context${context.ok ? "" : " is-over"}`} onClick={() => setOpen(!open)} data-testid="chat-context" title="Kontext">
        {context.sources.length} {context.sources.length === 1 ? "Quelle" : "Quellen"} · {formatBytes(bytes)} · ≈ {context.estimatedTokens.toLocaleString("de-DE")} / {context.budgetTokens.toLocaleString("de-DE")} Tokens
      </button>
      {open ? (
        <div className="bd-chat-popover" role="dialog" aria-label="Kontext">
          <div className="bd-chat-popover-head">Kontext</div>
          {context.sources.length === 0 ? <p className="bd-muted">Keine Quellen verbunden.</p> : null}
          <ul>
            {[...context.sources].sort((a, b) => b.bytes - a.bytes).map((source) => (
              <li key={source.nodeId}>
                <span>{source.title}</span>
                <span className="bd-muted">{formatBytes(source.bytes)}</span>
              </li>
            ))}
          </ul>
          <p className="bd-muted">Schätzung: Bytes als Obergrenze, plus Engine-Overhead und 16.000 Tokens Antwortreserve. Der Verlauf kommt beim Senden dazu.</p>
        </div>
      ) : null}
    </span>
  );
}

function BrandMenu({ value, onChange, boardText, fallback, onSave, disabled }: { value: "none" | "chris"; onChange(value: "none" | "chris"): void; boardText: string; fallback: string; onSave(text: string): void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <span className="bd-chat-menu-wrap">
      <button type="button" className="bd-chat-pill" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-label="Brand Voice">
        <NotePencil size={14} /> {value === "chris" ? "Chris" : "Keine Brand"} <CaretDown size={12} />
      </button>
      {open ? (
        <div className="bd-chat-popover bd-chat-popover--up" role="menu">
          <button type="button" role="menuitemradio" aria-checked={value === "none"} className="bd-chat-option" onClick={() => (onChange("none"), setOpen(false))} disabled={disabled}>
            {value === "none" ? <Check size={14} /> : <span className="bd-chat-option-gap" />} Keine
          </button>
          <button type="button" role="menuitemradio" aria-checked={value === "chris"} className="bd-chat-option" onClick={() => (onChange("chris"), setOpen(false))} disabled={disabled}>
            {value === "chris" ? <Check size={14} /> : <span className="bd-chat-option-gap" />} Chris
          </button>
          <button type="button" className="bd-chat-option" onClick={() => setEditing(boardText || fallback)} disabled={disabled}>
            <PencilSimple size={14} /> Brand Voice bearbeiten
          </button>
          {editing !== null ? (
            <div className="bd-chat-brand-edit">
              <textarea className="bd-input nokey" rows={6} value={editing} maxLength={20_000} aria-label="Brand Voice" onChange={(event) => setEditing(event.target.value)} />
              <div className="bd-chat-brand-actions">
                <button type="button" className="bd-button bd-button--ghost" onClick={() => setEditing(null)}>
                  Abbrechen
                </button>
                <button type="button" className="bd-button bd-button--primary" onClick={() => (onSave(editing), setEditing(null), setOpen(false))}>
                  Speichern
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

function ModelMenu({ settings, engines, onChange, onRefresh, disabled }: { settings: ChatSettings; engines: EngineStatus[] | null; onChange(patch: Partial<ChatSettings>): void; onRefresh(): void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const current = engines?.find((engine) => engine.id === settings.engine);
  const label = settings.engine === "codex" ? (current?.models[0]?.label ?? "Codex") : (current?.models.find((model) => model.id === settings.modelId)?.label ?? modelLabel(settings.engine, settings.modelId));
  return (
    <span className="bd-chat-menu-wrap">
      <button
        type="button"
        className="bd-chat-pill"
        aria-haspopup="menu"
        aria-label="Modell"
        data-testid="model-menu"
        onClick={() => {
          if (!open) onRefresh();
          setOpen(!open);
        }}
      >
        <Brain size={14} /> {label} · {EFFORT_LABELS[settings.effort]} <CaretDown size={12} />
      </button>
      {open ? (
        <div className="bd-chat-popover bd-chat-popover--up bd-chat-models" role="menu">
          {engines === null ? <p className="bd-muted">Lädt …</p> : null}
          {engines?.map((engine) => (
            <div key={engine.id} className="bd-chat-engine">
              <div className="bd-chat-engine-head">
                <span>{engine.label}</span>
                <span className={`bd-chat-engine-state${engine.available ? " is-ok" : " is-off"}`}>{engine.available ? (engine.version ?? "bereit") : "nicht verfügbar"}</span>
              </div>
              {!engine.available && engine.reason ? <p className="bd-chat-engine-reason">{engine.reason}</p> : null}
              {engine.models.map((model) => {
                const selected = settings.engine === engine.id && (engine.id === "codex" || settings.modelId === model.id);
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className="bd-chat-option"
                    disabled={disabled || !engine.available}
                    onClick={() => {
                      onChange({ engine: engine.id, modelId: model.id });
                      setOpen(false);
                    }}
                  >
                    {selected ? <Check size={14} /> : <span className="bd-chat-option-gap" />} {model.label}
                    <span className="bd-muted bd-chat-option-note">{Math.round(model.budgetTokens / 1000)}k</span>
                  </button>
                );
              })}
            </div>
          ))}
          <div className="bd-chat-efforts" role="group" aria-label="Denkstufe">
            <span className="bd-muted">Denkstufe</span>
            {EFFORTS.map((effort) => (
              <button key={effort} type="button" className={`bd-chat-effort${settings.effort === effort ? " is-active" : ""}`} aria-pressed={settings.effort === effort} disabled={disabled} onClick={() => onChange({ effort })}>
                {EFFORT_LABELS[effort]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </span>
  );
}
