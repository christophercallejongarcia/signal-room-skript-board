"use client";

import { ArrowLeft, ChatCircleDots, FolderSimple, Moon, PencilSimpleLine, Sun, TextT, YoutubeLogo } from "@phosphor-icons/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BoardSession, type SaveState } from "@/lib/board/board-session";
import { createNodeCommand, disconnectCommand, groupCommand, ungroupCommand } from "@/lib/board/commands";
import { httpTransport } from "@/lib/board/http-transport";
import { newNodeId, type NodeType } from "@/lib/board/ids";
import { IdbJournal } from "@/lib/board/journal-idb";
import { MemoryJournal, type JournalStore } from "@/lib/board/journal";
import { canonicalYoutubeUrl, looksLikeUrl, sanitizeMarkdownMedia, youtubeVideoId } from "@/lib/board/markdown";
import { freeSpot } from "@/lib/board/layout";
import { NODE_DEFAULTS, type NodeShape, type Position, type Provenance } from "@/lib/board/ops";
import { useBoardTheme } from "@/lib/board/theme";
import { claimEditorSessionId, webLocks } from "@/lib/board/web-locks";
import { Canvas, type CanvasHandle } from "./canvas";
import { EditorContext, type EditorContextValue } from "./context";
import { SourcesProvider } from "./sources";

const SAVE_LABEL: Record<SaveState, string> = {
  loading: "Lädt …",
  saved: "Gespeichert",
  saving: "Speichert …",
  offline: "Offline, lokal gesichert",
  conflict: "Konflikt",
  readonly: "Nur lesend",
  localfail: "Lokale Sicherung fehlgeschlagen",
  reload: "Neu geladen",
};

/** Keys in inputs and editors stay there (point 59). */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || Boolean(element.closest?.(".bn-editor, .nokey, [contenteditable='true']"));
}

/**
 * One BoardSession per board and page, shared across React StrictMode's double
 * mount; it closes shortly after the last user unmounts.
 */
const sessions = new Map<string, { promise: Promise<BoardSession>; refs: number; closeTimer?: ReturnType<typeof setTimeout> }>();

function retainSession(boardId: string, deploymentId: string): Promise<BoardSession> {
  let entry = sessions.get(boardId);
  if (!entry) {
    const promise = (async () => {
      const editorSessionId = await claimEditorSessionId();
      let journal: JournalStore;
      try {
        journal = new IdbJournal();
      } catch {
        journal = new MemoryJournal();
      }
      const session = new BoardSession({ boardId, deploymentId, editorSessionId, transport: httpTransport(boardId), journal, locks: webLocks });
      if (process.env.NEXT_PUBLIC_BOARD_TEST_HOOKS === "1") (window as unknown as { __boardSession?: BoardSession }).__boardSession = session;
      await session.open();
      return session;
    })();
    entry = { promise, refs: 0 };
    sessions.set(boardId, entry);
    promise.catch(() => sessions.delete(boardId));
  }
  if (entry.closeTimer) clearTimeout(entry.closeTimer);
  entry.refs += 1;
  return entry.promise;
}

function releaseSession(boardId: string) {
  const entry = sessions.get(boardId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.closeTimer = setTimeout(() => {
    sessions.delete(boardId);
    void entry.promise.then((session) => session.close()).catch(() => {});
  }, 200);
}

function useSession(boardId: string, deploymentId: string) {
  const [session, setSession] = useState<BoardSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    retainSession(boardId, deploymentId).then(
      (value) => !cancelled && setSession(value),
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Board konnte nicht geladen werden."),
    );
    const onUnload = () => void sessions.get(boardId)?.promise.then((value) => value.close());
    window.addEventListener("pagehide", onUnload);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onUnload);
      releaseSession(boardId);
    };
  }, [boardId, deploymentId]);
  return { session, error };
}

export function BoardEditor({ boardId, deploymentId }: { boardId: string; deploymentId: string }) {
  const { session, error } = useSession(boardId, deploymentId);
  const [theme, toggleTheme] = useBoardTheme();
  if (error) {
    return (
      <main className="bd-needs-convex">
        <div>
          <h1>Board nicht verfügbar</h1>
          <p>{error}</p>
          <p>
            <a href="/board">Zurück zu allen Boards</a>
          </p>
        </div>
      </main>
    );
  }
  if (!session) {
    return (
      <main className="bd-needs-convex">
        <p className="bd-muted">Board lädt …</p>
      </main>
    );
  }
  return (
    <ReactFlowProvider>
      <LoadedEditor session={session} theme={theme} toggleTheme={toggleTheme} />
    </ReactFlowProvider>
  );
}

function LoadedEditor({ session, theme, toggleTheme }: { session: BoardSession; theme: "light" | "dark"; toggleTheme(): void }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const canvas = useRef<CanvasHandle>(null);
  const [focusTitleId, setFocusTitleId] = useState<string | null>(null);
  const [youtubeField, setYoutubeField] = useState<{ open: boolean; value: string; error: string | null }>({ open: false, value: "", error: null });
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  const writable = snapshot.writable;

  const actions = useMemo(
    () => ({
      deleteEdge: (edgeId: string) => void session.run(disconnectCommand(session.model, edgeId)),
      renameNode: (nodeId: string, title: string) => void session.setTitle(nodeId, title),
      focusTitleHandled: (nodeId: string) => setFocusTitleId((current) => (current === nodeId ? null : current)),
      createAnswerNode: async (chatNodeId: string, answer: { title: string; markdown: string; provenance?: Provenance }) => {
        const chat = session.model.nodes.get(chatNodeId);
        if (!chat || !session.writable) return null;
        const size = NODE_DEFAULTS.textNode;
        const position = freeSpot(session.model, { x: chat.position.x + chat.width + 60, y: chat.position.y }, size);
        const id = newNodeId("textNode");
        const shape: NodeShape = { id, type: "textNode", position, width: size.width, height: size.height, zIndex: size.zIndex, data: { title: answer.title } };
        const ok = await session.run(createNodeCommand(shape, { blocks: "", markdown: answer.markdown, ...(answer.provenance ? { provenance: answer.provenance } : {}) }));
        return ok ? id : null;
      },
    }),
    [session],
  );

  const context: EditorContextValue = useMemo(() => ({ session, snapshot, theme, focusTitleId, actions }), [session, snapshot, theme, focusTitleId, actions]);

  const createNode = useCallback(
    async (type: NodeType, options: { at?: Position; centered?: boolean; data?: NodeShape["data"]; text?: { blocks: string; markdown: string } } = {}) => {
      if (!session.writable) return null;
      const size = NODE_DEFAULTS[type];
      const anchor = options.at ?? canvas.current?.viewportCenter() ?? { x: 0, y: 0 };
      const wanted = options.centered === false ? anchor : { x: Math.round(anchor.x - size.width / 2), y: Math.round(anchor.y - size.height / 2) };
      const position = freeSpot(session.model, wanted, size);
      const id = newNodeId(type);
      const shape: NodeShape = { id, type, position, width: size.width, height: size.height, zIndex: size.zIndex, data: options.data ?? { title: type === "groupNode" ? "Gruppe" : "" } };
      if (type === "chatNode") shape.data = { ...shape.data, engine: "claude", modelId: "sonnet", effort: "low", brandVoice: "chris" };
      const ok = await session.run(createNodeCommand(shape, type === "textNode" ? (options.text ?? { blocks: "", markdown: "" }) : undefined));
      if (ok) {
        canvas.current?.select([id]);
        if (type === "textNode") setFocusTitleId(id);
      }
      return ok ? id : null;
    },
    [session],
  );

  const createYoutube = useCallback(
    async (input: string, at?: Position) => {
      const videoId = youtubeVideoId(input);
      if (!videoId) return false;
      await createNode("youtubeNode", { at, centered: !at, data: { title: "", videoId, url: canonicalYoutubeUrl(videoId) } });
      return true;
    },
    [createNode],
  );

  const groupSelection = useCallback(() => {
    const ids = canvas.current?.selectedIds() ?? [];
    const command = groupCommand(session.model, ids);
    if (command.ops.length > 0) void session.run(command);
  }, [session]);

  const ungroupSelection = useCallback(() => {
    for (const id of canvas.current?.selectedIds() ?? []) {
      if (session.model.nodes.get(id)?.type === "groupNode") void session.run(ungroupCommand(session.model, id));
    }
  }, [session]);

  // Keyboard (points 59, 62, 30): tool keys only outside inputs and editors, Cmd+Z in editors stays there.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        void (event.shiftKey ? session.redo() : session.undo());
        return;
      }
      if (mod && key === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      if (mod || event.altKey || !session.writable) return;
      if (key === "c") void createNode("chatNode");
      else if (key === "t") void createNode("textNode");
      else if (key === "g") void createNode("groupNode");
      else if (key === "y") setYoutubeField({ open: true, value: "", error: null });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNode, groupSelection, session, ungroupSelection]);

  // Paste on the canvas (point 64). Paste into editors and fields stays there.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target) || isTypingTarget(document.activeElement) || !session.writable) return;
      const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (!text) return;
      event.preventDefault();
      const at = canvas.current?.mousePosition();
      if (youtubeVideoId(text)) {
        void createYoutube(text, at);
        return;
      }
      if (looksLikeUrl(text)) {
        session.setNotice("Im MVP nur YouTube-Links.");
        return;
      }
      void createNode("textNode", { at, centered: false, text: { blocks: "", markdown: sanitizeMarkdownMedia(text) } });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [createNode, createYoutube, session]);

  const notice = snapshot.notice && snapshot.notice !== dismissedNotice ? snapshot.notice : null;
  const showTakeover = !writable && (snapshot.saveState === "readonly" || /anderer Tab/.test(snapshot.notice ?? ""));

  const videoIds = useMemo(() => [...snapshot.model.nodes.values()].filter((node) => node.type === "youtubeNode" && node.data.videoId).map((node) => node.data.videoId!), [snapshot.model]);

  return (
    <EditorContext.Provider value={context}>
      <SourcesProvider session={session} videoIds={videoIds} writable={writable}>
      <div className="bd-editor" data-save-state={snapshot.saveState} data-writable={writable ? "true" : "false"}>
        <BoardHeader
          title={snapshot.meta?.title ?? ""}
          saveState={snapshot.saveState}
          writable={writable}
          theme={theme}
          onToggleTheme={toggleTheme}
          onRename={(title) => void session.renameBoard(title)}
          onTakeover={showTakeover ? () => void session.takeOver() : null}
        />
        {notice || (writable && snapshot.offers.length > 0) ? (
          <div className="bd-banners">
            {notice ? (
              <div className={`bd-banner${snapshot.saveState === "localfail" || snapshot.saveState === "conflict" ? " bd-banner--warn" : ""}`} role="status">
                <span>{notice}</span>
                <button type="button" className="bd-button bd-button--ghost" onClick={() => setDismissedNotice(snapshot.notice)}>
                  Ausblenden
                </button>
              </div>
            ) : null}
            {writable && snapshot.offers.length > 0 ? (
              <div className="bd-banner bd-banner--warn" role="status" data-offers={snapshot.offers.reduce((sum, offer) => sum + offer.entries.length, 0)}>
                <span>Unbestätigte Änderungen aus einer früheren Sitzung ({snapshot.offers.reduce((sum, offer) => sum + offer.entries.length, 0)}).</span>
                <button type="button" className="bd-button" onClick={() => void session.acceptOffers()}>
                  Als Konfliktkopien übernehmen
                </button>
                <button type="button" className="bd-button bd-button--ghost" onClick={() => void session.discardOffers()}>
                  Verwerfen
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="bd-workspace">
          <Toolbar
            disabled={!writable}
            onChat={() => void createNode("chatNode")}
            onText={() => void createNode("textNode")}
            onGroup={() => void createNode("groupNode")}
            youtube={youtubeField}
            setYoutube={setYoutubeField}
            onYoutube={async (value) => {
              const ok = await createYoutube(value);
              setYoutubeField(ok ? { open: false, value: "", error: null } : { open: true, value, error: "Kein YouTube-Link erkannt." });
            }}
          />
          <Canvas ref={canvas} />
        </div>
      </div>
      </SourcesProvider>
    </EditorContext.Provider>
  );
}

function BoardHeader({
  title,
  saveState,
  writable,
  theme,
  onToggleTheme,
  onRename,
  onTakeover,
}: {
  title: string;
  saveState: SaveState;
  writable: boolean;
  theme: "light" | "dark";
  onToggleTheme(): void;
  onRename(title: string): void;
  onTakeover: (() => void) | null;
}) {
  const [draft, setDraft] = useState(title);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(title);
  }, [title]);
  return (
    <header className="bd-header">
      <a className="bd-header-back" href="/board" aria-label="Alle Boards">
        <ArrowLeft size={16} /> Alle Boards
      </a>
      <span className="bd-header-divider" />
      <input
        className="bd-header-title nokey"
        value={draft}
        aria-label="Board-Titel"
        readOnly={!writable}
        maxLength={200}
        onFocus={() => (editing.current = true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          editing.current = false;
          if (draft.trim() && draft !== title) onRename(draft);
          else setDraft(title);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") {
            setDraft(title);
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className={`bd-save bd-save--${saveState}`} data-testid="save-state">
        {SAVE_LABEL[saveState]}
      </span>
      <div className="bd-header-spacer" />
      {onTakeover ? (
        <button type="button" className="bd-button bd-button--primary" onClick={onTakeover}>
          <PencilSimpleLine size={16} /> Hier bearbeiten
        </button>
      ) : null}
      <button type="button" className="bd-icon-button" onClick={onToggleTheme} aria-label={theme === "light" ? "Dunkles Theme" : "Helles Theme"} title={theme === "light" ? "Dunkles Theme" : "Helles Theme"}>
        {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
      </button>
    </header>
  );
}

function Toolbar({
  disabled,
  onChat,
  onText,
  onGroup,
  youtube,
  setYoutube,
  onYoutube,
}: {
  disabled: boolean;
  onChat(): void;
  onText(): void;
  onGroup(): void;
  youtube: { open: boolean; value: string; error: string | null };
  setYoutube(value: { open: boolean; value: string; error: string | null }): void;
  onYoutube(value: string): void;
}) {
  return (
    <nav className="bd-toolbar" aria-label="Werkzeuge">
      <button type="button" className="bd-tool" onClick={onChat} disabled={disabled} aria-label="Chat (C)" title="Chat (C)">
        <ChatCircleDots size={24} />
      </button>
      <div className="bd-tool-wrap">
        <button type="button" className={`bd-tool${youtube.open ? " is-active" : ""}`} onClick={() => setYoutube({ open: !youtube.open, value: "", error: null })} disabled={disabled} aria-label="YouTube (Y)" title="YouTube (Y)">
          <YoutubeLogo size={24} />
        </button>
        {youtube.open ? (
          <form
            className="bd-url-field"
            onSubmit={(event) => {
              event.preventDefault();
              onYoutube(youtube.value);
            }}
          >
            <input
              autoFocus
              className="bd-input"
              placeholder="YouTube-Link einfügen"
              aria-label="YouTube-Link"
              value={youtube.value}
              onChange={(event) => setYoutube({ ...youtube, value: event.target.value, error: null })}
              onKeyDown={(event) => event.key === "Escape" && setYoutube({ open: false, value: "", error: null })}
            />
            <button type="submit" className="bd-button bd-button--primary">
              Hinzufügen
            </button>
            {youtube.error ? <p className="bd-url-error">{youtube.error}</p> : null}
          </form>
        ) : null}
      </div>
      <button type="button" className="bd-tool" onClick={onText} disabled={disabled} aria-label="Text (T)" title="Text (T)">
        <TextT size={24} />
      </button>
      <button type="button" className="bd-tool" onClick={onGroup} disabled={disabled} aria-label="Gruppe (G)" title="Gruppe (G)">
        <FolderSimple size={24} />
      </button>
    </nav>
  );
}
