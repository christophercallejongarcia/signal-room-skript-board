"use client";

import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  CheckCircle,
  Clock,
  FileText,
  Microphone,
  X,
} from "@phosphor-icons/react";
import { useEffect, type MouseEvent } from "react";
import { CoverImage, formatNumber, networkName } from "@/components/display";
import type { Creator, RankedSignal } from "@/lib/contracts";
import {
  transcriptDisplayStatus,
  TRANSCRIPT_STATUS_META,
  type TranscriptDisplayStatus,
} from "@/lib/transcript-display";

type TranscriptStatusSignal = Pick<RankedSignal, "transcript" | "transcriptStatus">;

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

export function ReelDetailPanel({
  signal,
  creator,
  onClose,
}: {
  signal: RankedSignal;
  creator: Creator;
  onClose: () => void;
}) {
  const status = transcriptDisplayStatus(signal);
  const meta = TRANSCRIPT_STATUS_META[status];
  const attempts = Math.max(0, Math.floor(signal.transcriptAttempts ?? 0));
  const segments = signal.transcriptSegments?.filter((segment) => segment.text.trim()).filter((segment) => (
    Number.isFinite(segment.start) && Number.isFinite(segment.end)
  )) ?? [];
  const actionLabel = status === "none" ? "Transcribe" : status === "pending" ? "Transcribing…" : "Retry";
  const ActionIcon = status === "none" ? Microphone : ArrowCounterClockwise;

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
            <h2 id="reel-detail-title">{signal.title}</h2>
            <p>{creator.handle} · {signal.topic} · {signal.format === "reel" ? "Reel" : "Short form"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close Reel view">
            <X size={18} />
          </button>
        </header>

        <div className="reel-detail-overview">
          <div className={`reel-detail-cover ${signal.format === "reel" ? "portrait" : "landscape"}`}>
            <CoverImage signal={signal} index={0} />
          </div>
          {signal.url && (
            <a className="signal-link reel-detail-source" href={signal.url} target="_blank" rel="noreferrer">
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
              <span>{creator.handle} · published {new Date(signal.publishedAt).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="reel-detail-stats">
            <div><strong>{formatNumber(signal.plays ?? signal.views)}</strong><span>{signal.plays === undefined ? "views" : "plays"}</span></div>
            <div><strong>{formatNumber(signal.likes)}</strong><span>likes</span></div>
            <div><strong>{formatNumber(signal.comments)}</strong><span>comments</span></div>
            <div><strong className="lime">{signal.outlier.toFixed(1)}x</strong><span>outlier</span></div>
          </div>

          <div className="reel-detail-facts">
            <span>Duration <strong>{formatDuration(signal.durationSeconds)}</strong></span>
            <span>Published <strong>{new Date(signal.publishedAt).toLocaleDateString()}</strong></span>
          </div>

          <section className="reel-detail-caption" aria-labelledby="reel-caption-title">
            <h3 id="reel-caption-title">Caption</h3>
            <p>{signal.caption?.trim() || "No caption on this Reel."}</p>
          </section>
        </div>

        <section className={`reel-transcript status-${status}`} aria-labelledby="reel-transcript-title">
          <div className="reel-transcript-heading">
            <div>
              <p className="kicker">Spoken content</p>
              <h3 id="reel-transcript-title">Transcript</h3>
            </div>
            <TranscriptStatusBadge signal={signal} />
          </div>

          <div className="reel-transcript-state">
            {statusIcon(status)}
            <p>{statusDescription(status, signal.transcriptError)}</p>
          </div>

          <div className="reel-transcript-facts">
            <span>Last update <strong>{formatTranscriptStamp(signal.transcriptUpdatedAt)}</strong></span>
            <span><strong>{attempts}</strong> {attempts === 1 ? "attempt" : "attempts"}</span>
          </div>

          {status === "ready" && (
            <div className="reel-transcript-copy">
              <div className="transcript-copy-heading">
                <span>Original transcript</span>
                {segments.length > 0 && <span>{segments.length} timecoded segments</span>}
              </div>
              <p className="transcript-original">{signal.transcript?.trim() || "The actor returned an empty transcript."}</p>
              {segments.length > 0 && (
                <ol className="transcript-segments" aria-label="Transcript timecodes">
                  {segments.map((segment, index) => (
                    <li key={`${segment.start}-${index}`}>
                      <time>{formatTimecode(segment.start)}</time>
                      <span>{segment.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          <div className="reel-transcript-actions">
            <button className="secondary-button" type="button" disabled title="Available in Ticket 05">
              <ActionIcon size={14} className={status === "pending" ? "spin" : undefined} /> {actionLabel}
            </button>
            <span>Action available in Ticket 05.</span>
          </div>

          <p className="reel-transcript-note">The original transcript stays unchanged. Later corrections belong here too.</p>
        </section>
      </section>
    </div>
  );
}
