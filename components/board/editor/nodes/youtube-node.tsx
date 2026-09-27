"use client";

import { ArrowClockwise, ArrowSquareOut, CopySimple, CurrencyDollar, WarningCircle, YoutubeLogo } from "@phosphor-icons/react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";
import { boardApi, BoardClientError } from "@/lib/board/client";
import { useEditor } from "../context";
import { useSources } from "../sources";

const number = new Intl.NumberFormat("de-DE");
const compact = new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 });

function statusText(status: string | undefined, chars: number | undefined, error: string | undefined) {
  switch (status) {
    case "ready":
      return { tone: "ok", text: `Transkript ✓ ${number.format(chars ?? 0)} Zeichen` };
    case "pending":
      return { tone: "busy", text: "Transkript lädt …" };
    case "apify-pending":
      return { tone: "busy", text: "Transkript über Apify lädt …" };
    case "no-captions":
      return { tone: "warn", text: "Keine Untertitel" };
    case "fetch-failed":
      return { tone: "error", text: error ?? "Abruf fehlgeschlagen" };
    case "apify-failed":
      return { tone: "error", text: error ?? "Apify-Abruf fehlgeschlagen" };
    case "apify-unknown":
      return { tone: "warn", text: "Apify ohne Rückmeldung, möglicherweise schon bezahlt" };
    default:
      return { tone: "busy", text: "Wird abgerufen …" };
  }
}

/** YouTube node (point 71): 290 × 206, thumbnail, title, channel, views, factor, transcript status, notes for the AI. */
export const YoutubeNodeView = memo(function YoutubeNodeView({ id, selected }: NodeProps) {
  const { session, snapshot } = useEditor();
  const { sources, errors, apify, ingest, buyApify } = useSources();
  const node = snapshot.model.nodes.get(id);
  const [copied, setCopied] = useState<string | null>(null);
  const [notes, setNotes] = useState(() => session.notesFor(id));
  const editingNotes = useRef(false);
  const storedNotes = session.notesFor(id);
  useEffect(() => {
    if (!editingNotes.current) setNotes(storedNotes);
  }, [storedNotes]);
  if (!node) return null;

  const videoId = node.data.videoId ?? "";
  const source = sources.get(videoId);
  const now = Date.now();
  const expired = source?.transcriptStatus === "pending" && source.claimExpiresAt !== undefined && source.claimExpiresAt < now;
  const status = statusText(expired ? "fetch-failed" : source?.transcriptStatus, source?.activeVersion?.chars, expired ? "Abruf hängt, bitte erneut versuchen" : (errors.get(videoId) ?? source?.error));
  const canRetry = expired || source?.transcriptStatus === "fetch-failed" || (!source && errors.has(videoId));
  const offerApify = apify.enabled && (source?.transcriptStatus === "no-captions" || source?.transcriptStatus === "apify-failed" || source?.transcriptStatus === "apify-unknown" || (source?.transcriptStatus === "fetch-failed" && source.attempts >= 2));
  const title = session.titleFor(id) || source?.title || "YouTube-Video";

  const copyTranscript = async () => {
    try {
      const result = await boardApi<{ text: string }>(`/youtube/transcript?videoId=${encodeURIComponent(videoId)}`);
      await navigator.clipboard.writeText(result.text);
      setCopied("Kopiert");
    } catch (error) {
      setCopied(error instanceof BoardClientError ? error.message : "Kopieren fehlgeschlagen");
    }
    setTimeout(() => setCopied(null), 2_000);
  };

  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top} className="bd-node-toolbar">
        <a className="bd-node-tool" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer">
          <ArrowSquareOut size={14} /> Öffnen
        </a>
        <button type="button" className="bd-node-tool" onClick={() => void copyTranscript()} disabled={source?.transcriptStatus !== "ready"}>
          <CopySimple size={14} /> {copied ?? "Transkript kopieren"}
        </button>
        {canRetry && snapshot.writable ? (
          <button type="button" className="bd-node-tool" onClick={() => void ingest(videoId, true)}>
            <ArrowClockwise size={14} /> Erneut versuchen
          </button>
        ) : null}
        {offerApify && snapshot.writable ? (
          <button type="button" className="bd-node-tool bd-node-tool--warn" onClick={() => void buyApify(videoId)} title={source?.transcriptStatus === "apify-unknown" ? "Ein früherer Kauf ist womöglich schon bezahlt." : undefined}>
            <CurrencyDollar size={14} /> Transkript über Apify holen (höchstens {apify.maxUsd.toLocaleString("de-DE")} $)
          </button>
        ) : null}
      </NodeToolbar>
      <div className={`bd-node bd-node--youtube${selected ? " is-selected" : ""}`} data-node-id={id} data-node-type="youtubeNode" data-transcript-status={expired ? "expired" : (source?.transcriptStatus ?? "none")}>
        <header className="bd-node-head bd-drag" title={title}>
          <span className="bd-node-icon">
            <YoutubeLogo size={16} weight="fill" />
          </span>
          <span className="bd-node-title bd-node-title--static">{title}</span>
        </header>
        <div className="bd-youtube-body">
          {videoId ? <img className="bd-youtube-thumb" src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" draggable={false} /> : null}
          <div className="bd-youtube-meta">
            <div className="bd-youtube-chips">
              {source?.views !== undefined ? <span className="bd-chip">{compact.format(source.views)} Aufrufe</span> : null}
              {source?.outlier !== undefined ? <span className="bd-chip bd-chip--accent">{source.outlier.toLocaleString("de-DE")}× Kanal</span> : null}
            </div>
            {source?.channelTitle ? <div className="bd-youtube-channel">{source.channelTitle}</div> : null}
            <div className={`bd-youtube-status bd-youtube-status--${status.tone}`} data-testid="transcript-status">
              {status.tone === "error" || status.tone === "warn" ? <WarningCircle size={12} weight="fill" /> : null}
              {status.text}
            </div>
          </div>
        </div>
        <Handle type="source" position={Position.Right} id="connector" className="bd-handle" />
      </div>
      {selected ? (
        <div className="bd-notes-card nodrag nowheel">
          <textarea
            className="bd-notes nokey"
            placeholder="Notizen für die KI"
            aria-label="Notizen für die KI"
            value={notes}
            maxLength={8_000}
            readOnly={!snapshot.writable}
            onFocus={() => (editingNotes.current = true)}
            onBlur={() => (editingNotes.current = false)}
            onChange={(event) => {
              setNotes(event.target.value);
              void session.setNotes(id, event.target.value);
            }}
          />
        </div>
      ) : null}
    </>
  );
});
