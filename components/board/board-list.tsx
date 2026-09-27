"use client";

import { MagnifyingGlass, Moon, PencilSimple, Plus, SquaresFour, Sun, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardClientError, boardApi, OPS_VERSION } from "@/lib/board/client";
import { formatDate, relativeTime } from "@/lib/board/format";
import { useBoardTheme } from "@/lib/board/theme";
import { ConfirmDialog } from "./confirm-dialog";

type BoardRow = { id: string; title: string; revision: number; createdAt: number; lastOpenedAt: number };

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)));
}

/** Board list (PLAN.md point 56): table, search, new board with key N, inline rename, soft delete. */
export function BoardList() {
  const router = useRouter();
  const [theme, toggleTheme] = useBoardTheme();
  const [boards, setBoards] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BoardRow | null>(null);
  const [creating, setCreating] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await boardApi<{ boards: BoardRow[] }>("/boards");
      setBoards(result.boards);
      setError(null);
    } catch (err) {
      setError(err instanceof BoardClientError ? err.message : "Boards konnten nicht geladen werden.");
      setBoards((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createBoard = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const result = await boardApi<{ id: string; title: string }>("/boards", { method: "POST", body: { opsVersion: OPS_VERSION } });
      const now = Date.now();
      setBoards((current) => [{ id: result.id, title: result.title, revision: 0, createdAt: now, lastOpenedAt: now }, ...(current ?? [])]);
      setQuery("");
      setEditing({ id: result.id, title: result.title });
      setError(null);
    } catch (err) {
      setError(err instanceof BoardClientError ? err.message : "Board konnte nicht angelegt werden.");
    } finally {
      setCreating(false);
    }
  }, [creating]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target) || pendingDelete) return;
      event.preventDefault();
      void createBoard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createBoard, pendingDelete]);

  useEffect(() => {
    if (!editing) return;
    renameRef.current?.focus();
    renameRef.current?.select();
  }, [editing?.id]);

  const commitRename = useCallback(async () => {
    if (!editing) return;
    const current = boards?.find((board) => board.id === editing.id);
    const title = editing.title.trim();
    setEditing(null);
    if (!current || !title || title === current.title) return;
    setBoards((list) => list?.map((board) => (board.id === current.id ? { ...board, title } : board)) ?? null);
    try {
      await boardApi(`/boards/${encodeURIComponent(current.id)}`, { method: "PATCH", body: { opsVersion: OPS_VERSION, title } });
    } catch (err) {
      setBoards((list) => list?.map((board) => (board.id === current.id ? { ...board, title: current.title } : board)) ?? null);
      setError(err instanceof BoardClientError ? err.message : "Umbenennen fehlgeschlagen.");
    }
  }, [boards, editing]);

  const confirmDelete = useCallback(async () => {
    const board = pendingDelete;
    setPendingDelete(null);
    if (!board) return;
    try {
      await boardApi(`/boards/${encodeURIComponent(board.id)}`, { method: "DELETE", body: { opsVersion: OPS_VERSION } });
      setBoards((list) => list?.filter((row) => row.id !== board.id) ?? null);
    } catch (err) {
      setError(err instanceof BoardClientError ? err.message : "Löschen fehlgeschlagen.");
    }
  }, [pendingDelete]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de");
    return (boards ?? []).filter((board) => !needle || board.title.toLocaleLowerCase("de").includes(needle));
  }, [boards, query]);

  return (
    <div className="bd-list-page">
      <main className="bd-list">
        <header className="bd-list-head">
          <div>
            <h1>Skript-Boards</h1>
            <p>Quellen sammeln, per Linie verbinden, Skript im Chat bauen.</p>
          </div>
          <div className="bd-list-actions">
            {boards && boards.length > 0 ? (
              <label className="bd-search">
                <MagnifyingGlass size={16} />
                <input className="bd-input" type="search" placeholder="Boards suchen" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Boards suchen" />
              </label>
            ) : null}
            <button type="button" className="bd-icon-button" onClick={toggleTheme} aria-label={theme === "light" ? "Dunkles Theme" : "Helles Theme"} title={theme === "light" ? "Dunkles Theme" : "Helles Theme"}>
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            {boards && boards.length > 0 ? (
              <button type="button" className="bd-button bd-button--primary" onClick={() => void createBoard()} disabled={creating}>
                <Plus size={16} weight="bold" /> Neues Board <span className="bd-kbd">N</span>
              </button>
            ) : null}
          </div>
        </header>

        {error ? (
          <div className="bd-error" role="alert">
            {error}
          </div>
        ) : null}

        {boards === null ? (
          <p className="bd-muted">Lädt …</p>
        ) : boards.length === 0 ? (
          <section className="bd-empty">
            <SquaresFour size={36} className="bd-muted" />
            <h2>Noch kein Board</h2>
            <p>Leg ein Board an und füge YouTube-Links mit Cmd+V ein.</p>
            <button type="button" className="bd-button bd-button--primary" onClick={() => void createBoard()} disabled={creating}>
              <Plus size={16} weight="bold" /> Neues Board <span className="bd-kbd">N</span>
            </button>
          </section>
        ) : (
          <div className="bd-table-card">
            <table className="bd-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="bd-col-date">Zuletzt geöffnet</th>
                  <th className="bd-col-date">Erstellt</th>
                  <th className="bd-col-actions" aria-label="Aktionen" />
                </tr>
              </thead>
              <tbody>
                {visible.map((board) => (
                  <tr key={board.id} data-board-id={board.id}>
                    <td>
                      {editing?.id === board.id ? (
                        <input
                          ref={renameRef}
                          className="bd-input bd-rename-input"
                          value={editing.title}
                          maxLength={200}
                          aria-label="Board-Name"
                          onChange={(event) => setEditing({ id: board.id, title: event.target.value })}
                          onBlur={() => void commitRename()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void commitRename();
                            if (event.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : (
                        <a
                          className="bd-board-link"
                          href={`/board/${encodeURIComponent(board.id)}`}
                          onClick={(event) => {
                            event.preventDefault();
                            router.push(`/board/${encodeURIComponent(board.id)}`);
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            setEditing({ id: board.id, title: board.title });
                          }}
                        >
                          <span className="bd-board-icon">
                            <SquaresFour size={16} weight="bold" />
                          </span>
                          {board.title}
                        </a>
                      )}
                    </td>
                    <td className="bd-col-date">{relativeTime(board.lastOpenedAt)}</td>
                    <td className="bd-col-date">{formatDate(board.createdAt)}</td>
                    <td className="bd-col-actions">
                      <button type="button" className="bd-icon-button" aria-label={`${board.title} umbenennen`} title="Umbenennen" onClick={() => setEditing({ id: board.id, title: board.title })}>
                        <PencilSimple size={16} />
                      </button>
                      <button type="button" className="bd-icon-button" aria-label={`${board.title} löschen`} title="Löschen" onClick={() => setPendingDelete(board)}>
                        <Trash size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="bd-muted">
                      Kein Board passt zu „{query}“.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </main>
      {pendingDelete ? (
        <ConfirmDialog
          title="Board löschen?"
          text={`„${pendingDelete.title}“ verschwindet aus der Liste. Die Daten bleiben in Convex erhalten.`}
          confirmLabel="Löschen"
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
