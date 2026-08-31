import type { SignalRecord, TranscriptStatus } from "./contracts";

/** The UI has one extra state for a Reel that has never had a transcript attempt. */
export type TranscriptDisplayStatus = TranscriptStatus | "none";

export type TranscriptStatusMeta = {
  label: string;
  compactLabel: string;
  description: string;
};

export const TRANSCRIPT_STATUS_META: Record<TranscriptDisplayStatus, TranscriptStatusMeta> = {
  none: {
    label: "No transcript",
    compactLabel: "No transcript",
    description: "This Reel has not been transcribed yet.",
  },
  pending: {
    label: "Pending",
    compactLabel: "Pending",
    description: "A transcript attempt is currently in progress.",
  },
  silent: {
    label: "Silent",
    compactLabel: "Silent",
    description: "The transcript actor returned no spoken text for this Reel.",
  },
  missing: {
    label: "Missing",
    compactLabel: "Missing",
    description: "The transcript actor did not return this Reel.",
  },
  failed: {
    label: "Failed",
    compactLabel: "Failed",
    description: "The last transcript attempt failed.",
  },
  ready: {
    label: "Ready",
    compactLabel: "Transcript ready",
    description: "The original transcript is ready to read.",
  },
};

/** Maps an unattempted Signal to the sixth display state without changing stored data. */
export function transcriptDisplayStatus(
  signal: Pick<SignalRecord, "transcript" | "transcriptStatus">,
): TranscriptDisplayStatus {
  return signal.transcriptStatus ?? (signal.transcript?.trim() ? "ready" : "none");
}
