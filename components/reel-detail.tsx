"use client";

import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  Check,
  CheckCircle,
  Clock,
  FileText,
  BookOpenText,
  Microphone,
  PencilSimple,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { useEffect, useState, type MouseEvent } from "react";
import { CoverImage, formatNumber, networkName } from "@/components/display";
import type { Creator, RankedSignal, Run, SignalRecord, TranscriptCorrection, TranscriptDictionaryEntry } from "@/lib/contracts";
import {
  applyTranscriptCorrectionAction,
  countTranscriptOccurrences,
  type TranscriptCorrectionAction,
} from "@/lib/transcript-corrections";
import {
  applyTranscriptDictionary,
  mergeTranscriptDictionaryEntries,
  removeTranscriptDictionaryEntry,
} from "@/lib/transcript-dictionary";
import {
  transcriptDisplayStatus,
  TRANSCRIPT_STATUS_META,
  type TranscriptDisplayStatus,
} from "@/lib/transcript-display";

type TranscriptStatusSignal = Pick<RankedSignal, "transcript" | "transcriptStatus">;

type TranscriptView = "original" | "working";

/** Splits the displayed copy into text and review marks without using HTML from the transcript. */
function markedTranscript(text: string, corrections: readonly TranscriptCorrection[], view: TranscriptView) {
  const ranges = corrections
    .filter((correction) => correction.status !== "rejected")
    .flatMap((correction) => {
      const needle = view === "working" && correction.status === "accepted" ? correction.replacement : correction.original;
      if (!needle) return [];
      const found: Array<{ start: number; end: number; correction: TranscriptCorrection }> = [];
      let from = 0;
      while (from < text.length) {
        const start = text.indexOf(needle, from);
        if (start < 0) break;
        found.push({ start, end: start + needle.length, correction });
        from = start + needle.length;
      }
      return found;
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const parts: Array<{ text: string; correction?: TranscriptCorrection }> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start) });
    parts.push({ text: text.slice(range.start, range.end), correction: range.correction });
    cursor = range.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts.length > 0 ? parts : [{ text }];
}

export function TranscriptStatusBadge({ signal, compact = false }: { signal: TranscriptStatusSignal; compact?: boolean }) {
  const status = transcriptDisplayStatus(signal);
  const meta = TRANSCRIPT_STATUS_META[status];
  return (
    <span
      className={`transcript-status-badge status-${status}${compact ? " compact" : ""}`}
      title={meta.description}
      aria-label={`Transcript status: ${meta.label}`}
    >
      <span className="transcript-status-dot" aria-hidden="true" />
      {compact ? meta.compactLabel : meta.label}
    </span>
  );
}

function formatTimecode(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return formatTimecode(seconds);
}

function formatTranscriptStamp(iso: string | undefined) {
  if (!iso) return "No attempt recorded";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusDescription(status: TranscriptDisplayStatus, error?: string) {
  if (status === "failed") return error || "The transcript attempt failed without a stored cause.";
  return TRANSCRIPT_STATUS_META[status].description;
}

function statusIcon(status: TranscriptDisplayStatus) {
  if (status === "ready") return <CheckCircle size={18} weight="fill" />;
  if (status === "pending") return <Clock size={18} />;
  return <FileText size={18} />;
}

const DEMO_TRANSCRIPT = "Im Demo-Modus wird dieses feste Transkript ohne Actor gespeichert.";

export function ReelDetailPanel({
  signal,
  creator,
  onClose,
  onSignalUpdated,
  onRunCreated,
  dictionary = [],
  onDictionaryUpdated,
  demo = false,
}: {
  signal: RankedSignal;
  creator: Creator;
  onClose: () => void;
  onSignalUpdated?: (signal: SignalRecord) => void;
  onRunCreated?: (run: Run) => void;
  dictionary?: TranscriptDictionaryEntry[];
  onDictionaryUpdated?: (entries: TranscriptDictionaryEntry[]) => void;
  demo?: boolean;
}) {
  const [displaySignal, setDisplaySignal] = useState<RankedSignal>(signal);
  const [actionState, setActionState] = useState<"idle" | "loading" | "error">("idle");
  const [actionError, setActionError] = useState("");
  const [transcriptView, setTranscriptView] = useState<TranscriptView>("original");
  const [correctionState, setCorrectionState] = useState<"idle" | "loading" | "error">("idle");
  const [correctionError, setCorrectionError] = useState("");
  const [correctionActionId, setCorrectionActionId] = useState<string | null>(null);
  const [editingCorrectionId, setEditingCorrectionId] = useState<string | null>(null);
  const [editingReplacement, setEditingReplacement] = useState("");
  const status = transcriptDisplayStatus(displaySignal);
  const attempts = Math.max(0, Math.floor(displaySignal.transcriptAttempts ?? 0));
  const segments = displaySignal.transcriptSegments?.filter((segment) => segment.text.trim()).filter((segment) => (
    Number.isFinite(segment.start) && Number.isFinite(segment.end)
  )) ?? [];
  const corrections = displaySignal.transcriptCorrections ?? [];
  const actionLabel = status === "none" ? "Transcribe" : status === "pending" ? "Transcribing…" : "Retry";
  const ActionIcon = status === "none" ? Microphone : ArrowCounterClockwise;

  useEffect(() => {
    setDisplaySignal(signal);
    setActionState("idle");
    setActionError("");
    setCorrectionState("idle");
    setCorrectionError("");
    setTranscriptView(signal.transcriptWorkingCopy ? "working" : "original");
    setEditingCorrectionId(null);
  }, [signal]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  function closeOnBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  function updateSignal(next: SignalRecord) {
    const merged = { ...displaySignal, ...next } as RankedSignal;
    setDisplaySignal(merged);
    onSignalUpdated?.(next);
  }

  async function suggestCorrections() {
    if (!displaySignal.transcript || correctionState === "loading") return;
    setCorrectionState("loading");
    setCorrectionError("");
    if (demo) {
      const updated = applyTranscriptDictionary(displaySignal, dictionary, {
        now: "2026-08-31T12:00:00.000Z",
        idFactory: (entry, index) => `demo-dictionary-${index}-${entry.wrong}`,
      });
      const added = (updated.transcriptCorrections?.filter((item) => item.source === "dictionary").length ?? 0)
        - corrections.filter((item) => item.source === "dictionary").length;
      if (updated !== displaySignal) updateSignal(updated);
      setCorrectionState("idle");
      setCorrectionError(added > 0 ? `${added} Wörterbuch-Treffer angewendet.` : "Demo mode has no new dictionary hit; no Bridge run is needed.");
      return;
    }
    try {
      const response = await fetch("/api/signals/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: displaySignal.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { signal?: SignalRecord; error?: string };
      if (!response.ok || !payload.signal) throw new Error(payload.error || `The correction Bridge answered with HTTP ${response.status}.`);
      updateSignal(payload.signal);
      setCorrectionState("idle");
    } catch (error) {
      setCorrectionState("error");
      setCorrectionError(error instanceof Error ? error.message : "The correction Bridge is unreachable.");
    }
  }

  async function changeCorrection(action: TranscriptCorrectionAction) {
    if (correctionActionId) return;
    setCorrectionActionId(action.correctionId);
    setCorrectionError("");
    try {
      if (action.action === "dictionary" || action.action === "remove-dictionary") {
        const correction = corrections.find((item) => item.id === action.correctionId);
        if (!correction) throw new Error(`unknown correction ${action.correctionId}`);
        if (action.action === "dictionary") {
          if (correction.status !== "accepted") throw new Error("Accept the correction before adding it to the dictionary.");
          onDictionaryUpdated?.(mergeTranscriptDictionaryEntries(dictionary, {
            wrong: correction.original,
            right: correction.replacement,
            createdAt: "2026-08-31T12:00:00.000Z",
          }));
        } else {
          onDictionaryUpdated?.(removeTranscriptDictionaryEntry(dictionary, {
            wrong: correction.original,
            right: correction.replacement,
          }));
        }
      } else if (demo) {
        updateSignal(applyTranscriptCorrectionAction(displaySignal, action));
      } else {
        const response = await fetch("/api/signals/transcript", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action),
        });
        const payload = (await response.json().catch(() => ({}))) as { signal?: SignalRecord; dictionary?: TranscriptDictionaryEntry[]; error?: string };
        if (!response.ok || !payload.signal) throw new Error(payload.error || `The correction action answered with HTTP ${response.status}.`);
        updateSignal(payload.signal);
        if (payload.dictionary) onDictionaryUpdated?.(payload.dictionary);
      }
      setEditingCorrectionId(null);
    } catch (error) {
      setCorrectionError(error instanceof Error ? error.message : "The correction could not be saved.");
    } finally {
      setCorrectionActionId(null);
    }
  }

  function startEditing(correction: TranscriptCorrection) {
    setEditingCorrectionId(correction.id);
    setEditingReplacement(correction.replacement);
    setCorrectionError("");
  }

  function saveEditing(correctionId: string) {
    void changeCorrection({ id: displaySignal.id, correctionId, action: "edit", replacement: editingReplacement });
  }

  async function transcribe() {
    if (actionState === "loading" || status === "pending" || status === "ready") return;
    setActionState("loading");
    setActionError("");

    if (demo) {
      const next: SignalRecord = {
        ...displaySignal,
        transcript: DEMO_TRANSCRIPT,
        transcriptSegments: [{ start: 0, end: 5.4, text: DEMO_TRANSCRIPT }],
        transcriptAttempts: attempts + 1,
        transcriptUpdatedAt: "2026-08-31T12:00:00.000Z",
        transcriptStatus: "ready",
        transcriptError: undefined,
      };
      updateSignal(next);
      setActionState("idle");
      return;
    }

    // Show the lock immediately. The server claim remains the authority when
    // two browser requests reach it at the same time.
    const previousSignal = displaySignal;
    updateSignal({
      ...displaySignal,
      transcriptStatus: "pending",
      transcriptAttempts: attempts + 1,
      transcriptUpdatedAt: new Date().toISOString(),
      transcriptError: undefined,
    });

    let serverSignal: SignalRecord | undefined;
    try {
      const response = await fetch("/api/signals/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: displaySignal.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { signal?: SignalRecord; run?: Run; error?: string };
      serverSignal = payload.signal;
      if (serverSignal) updateSignal(serverSignal);
      if (payload.run) onRunCreated?.(payload.run);
      if (!response.ok) throw new Error(payload.error || `The transcript run answered with HTTP ${response.status}.`);
      setActionState("idle");
    } catch (error) {
      // If the request failed before the server returned a Signal, remove the
      // optimistic lock. Otherwise a transient API error leaves this dialog
      // showing "Transcribing..." forever until it is reopened.
      if (!serverSignal) updateSignal(previousSignal);
      setActionState("error");
      setActionError(error instanceof Error ? error.message : "The transcript run failed.");
    }
  }

  return (
    <div className="reel-detail-backdrop" onMouseDown={closeOnBackdrop}>
      <section
        className="reel-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reel-detail-title"
      >
        <header className="reel-detail-header">
          <div>
            <p className="kicker">Reel view</p>
            <h2 id="reel-detail-title">{displaySignal.title}</h2>
            <p>{creator.handle} · {displaySignal.topic} · {displaySignal.format === "reel" ? "Reel" : "Short form"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close Reel view">
            <X size={18} />
          </button>
        </header>

        <div className="reel-detail-overview">
          <div className={`reel-detail-cover ${displaySignal.format === "reel" ? "portrait" : "landscape"}`}>
            <CoverImage signal={displaySignal} index={0} />
          </div>
          {displaySignal.url && (
            <a className="signal-link reel-detail-source" href={displaySignal.url} target="_blank" rel="noreferrer">
              Open on {networkName(creator.network)} <ArrowSquareOut size={12} />
            </a>
          )}
        </div>

        <div className="reel-detail-info">
          <div className="reel-detail-creator">
            <span className="creator-avatar" style={{ background: creator.accent }}>
              {creator.avatarUrl ? <img src={creator.avatarUrl} alt="" referrerPolicy="no-referrer" /> : creator.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{creator.name}</strong>
              <span>{creator.handle} · published {new Date(displaySignal.publishedAt).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="reel-detail-stats">
            <div><strong>{formatNumber(displaySignal.plays ?? displaySignal.views)}</strong><span>{displaySignal.plays === undefined ? "views" : "plays"}</span></div>
            <div><strong>{formatNumber(displaySignal.likes)}</strong><span>likes</span></div>
            <div><strong>{formatNumber(displaySignal.comments)}</strong><span>comments</span></div>
            <div><strong className="lime">{displaySignal.outlier.toFixed(1)}x</strong><span>outlier</span></div>
          </div>

          <div className="reel-detail-facts">
            <span>Duration <strong>{formatDuration(displaySignal.durationSeconds)}</strong></span>
            <span>Published <strong>{new Date(displaySignal.publishedAt).toLocaleDateString()}</strong></span>
          </div>

          <section className="reel-detail-caption" aria-labelledby="reel-caption-title">
            <h3 id="reel-caption-title">Caption</h3>
            <p>{displaySignal.caption?.trim() || "No caption on this Reel."}</p>
          </section>
        </div>

        <section className={`reel-transcript status-${status}`} aria-labelledby="reel-transcript-title">
          <div className="reel-transcript-heading">
            <div>
              <p className="kicker">Spoken content</p>
              <h3 id="reel-transcript-title">Transcript</h3>
            </div>
            <TranscriptStatusBadge signal={displaySignal} />
          </div>

          <div className="reel-transcript-state">
            {statusIcon(status)}
            <p>{statusDescription(status, displaySignal.transcriptError)}</p>
          </div>

          <div className="reel-transcript-facts">
            <span>Last update <strong>{formatTranscriptStamp(displaySignal.transcriptUpdatedAt)}</strong></span>
            <span><strong>{attempts}</strong> {attempts === 1 ? "attempt" : "attempts"}</span>
          </div>

          {status === "ready" && (
            <div className="reel-transcript-copy">
              <div className="transcript-copy-heading">
                <span>{transcriptView === "working" ? "Working copy" : "Original transcript"}</span>
                <div className="transcript-view-toggle" role="group" aria-label="Transcript version">
                  <button type="button" className={transcriptView === "original" ? "active" : ""} onClick={() => setTranscriptView("original")}>Original</button>
                  <button type="button" className={transcriptView === "working" ? "active" : ""} onClick={() => setTranscriptView("working")} disabled={!displaySignal.transcriptWorkingCopy}>Arbeitsfassung</button>
                </div>
              </div>
              <p className="transcript-original">
                {markedTranscript(
                  transcriptView === "working" ? displaySignal.transcriptWorkingCopy || displaySignal.transcript || "" : displaySignal.transcript || "",
                  corrections,
                  transcriptView,
                ).map((part, index) => part.correction ? (
                  <mark key={`${part.correction.id}-${index}`} title={`${part.correction.original} → ${part.correction.replacement}`}>
                    {part.text}
                  </mark>
                ) : <span key={`transcript-${index}`}>{part.text}</span>)}
              </p>
              {segments.length > 0 && transcriptView === "original" && (
                <ol className="transcript-segments" aria-label="Transcript timecodes">
                  {segments.map((segment, index) => (
                    <li key={`${segment.start}-${index}`}>
                      <time>{formatTimecode(segment.start)}–{formatTimecode(segment.end)}</time>
                      <span>{segment.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {status === "ready" && (
            <section className="transcript-corrections" aria-labelledby="transcript-corrections-title">
              <div className="transcript-corrections-heading">
                <div>
                  <h4 id="transcript-corrections-title">Korrekturen</h4>
                  <p>Nur klare Erkennungsfehler. Das Original bleibt unverändert.</p>
                </div>
                <button className="secondary-button" type="button" onClick={() => void suggestCorrections()} disabled={correctionState === "loading"}>
                  <Microphone size={14} className={correctionState === "loading" ? "spin" : undefined} />
                  {correctionState === "loading" ? "Vorschläge werden geladen…" : "Korrekturen vorschlagen"}
                </button>
              </div>
              {correctionState === "loading" && <p className="transcript-corrections-state">Der Bridge-Lauf prüft nur Wörter, keine Stilfragen.</p>}
              {correctionState === "error" && <p className="transcript-corrections-state error"><XCircle size={14} /> {correctionError}</p>}
              {correctionState === "idle" && correctionError && <p className="transcript-corrections-state">{correctionError}</p>}
              {corrections.length === 0 && correctionState !== "loading" && <p className="transcript-corrections-empty">Noch keine Korrekturen vorgeschlagen.</p>}
              {corrections.length > 0 && (
                <div className="transcript-correction-list">
                  {corrections.map((correction) => {
                    const occurrences = countTranscriptOccurrences(displaySignal.transcript || "", correction.original);
                    const editing = editingCorrectionId === correction.id;
                    const inDictionary = dictionary.some((entry) => entry.wrong === correction.original && entry.right === correction.replacement);
                    return (
                      <article className={`transcript-correction status-${correction.status}`} key={correction.id}>
                        <div className="transcript-correction-main">
                          <div className="transcript-correction-change"><code>{correction.original}</code><span>→</span><strong>{correction.replacement}</strong></div>
                          <p>{correction.reason}</p>
                          <small>{correction.source} · {occurrences} {occurrences === 1 ? "occurrence" : "occurrences"}</small>
                        </div>
                        {editing ? (
                          <div className="transcript-correction-edit">
                            <input aria-label={`Replacement for ${correction.original}`} value={editingReplacement} onChange={(event) => setEditingReplacement(event.target.value)} maxLength={120} />
                            <button className="ghost-button" type="button" onClick={() => saveEditing(correction.id)} disabled={correctionActionId === correction.id}><Check size={13} /> Save</button>
                            <button className="ghost-button" type="button" onClick={() => setEditingCorrectionId(null)} disabled={correctionActionId === correction.id}>Cancel</button>
                          </div>
                        ) : (
                          <div className="transcript-correction-actions">
                            <button className="ghost-button" type="button" onClick={() => void changeCorrection({ id: displaySignal.id, correctionId: correction.id, action: "accept" })} disabled={correctionActionId === correction.id || correction.status === "accepted"}>
                              <Check size={13} /> {correction.status === "accepted" ? "Accepted" : "Accept"}
                            </button>
                            {correction.status === "accepted" && (
                              <button className="ghost-button" type="button" onClick={() => void changeCorrection({ id: displaySignal.id, correctionId: correction.id, action: "dictionary" })} disabled={correctionActionId === correction.id || inDictionary}>
                                <BookOpenText size={13} /> {inDictionary ? "Im Wörterbuch" : "Ins Wörterbuch"}
                              </button>
                            )}
                            <button className="ghost-button" type="button" onClick={() => startEditing(correction)} disabled={correctionActionId === correction.id}><PencilSimple size={13} /> Edit</button>
                            <button className="ghost-button" type="button" onClick={() => void changeCorrection({ id: displaySignal.id, correctionId: correction.id, action: "reject" })} disabled={correctionActionId === correction.id || correction.status === "rejected"}>
                              <X size={13} /> {correction.status === "rejected" ? "Rejected" : "Reject"}
                            </button>
                            {inDictionary && (
                              <button className="ghost-button" type="button" onClick={() => void changeCorrection({ id: displaySignal.id, correctionId: correction.id, action: "remove-dictionary" })} disabled={correctionActionId === correction.id}>
                                <X size={13} /> Aus Wörterbuch entfernen
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <div className="reel-transcript-actions">
            <button className="secondary-button" type="button" onClick={transcribe} disabled={actionState === "loading" || status === "pending" || status === "ready"}>
              <ActionIcon size={14} className={status === "pending" ? "spin" : undefined} /> {actionLabel}
            </button>
            {status === "ready" ? <span>Transcript ready. No retry is needed.</span> : <span>{actionError || (status === "pending" ? "This Reel is locked until the current attempt finishes." : "The actor runs for this Reel only.")}</span>}
          </div>

          <p className="reel-transcript-note">The original transcript stays unchanged. Later corrections belong here too.</p>
        </section>
      </section>
    </div>
  );
}
