import type {
  SignalRecord,
  TranscriptAnalysis,
  TranscriptAnalysisChunk,
  TranscriptAnalysisChunkState,
  TranscriptAnalysisFeature,
  TranscriptAnalysisFinding,
  TranscriptAnalysisFramework,
  TranscriptAnalysisStatus,
  TranscriptAnalysisTextVersion,
  TranscriptSegment,
} from "./contracts.ts";
export type {
  TranscriptAnalysis,
  TranscriptAnalysisChunk,
  TranscriptAnalysisChunkState,
  TranscriptAnalysisFeature,
  TranscriptAnalysisFinding,
  TranscriptAnalysisFramework,
  TranscriptAnalysisStatus,
  TranscriptAnalysisTextVersion,
} from "./contracts.ts";

export const TRANSCRIPT_ANALYSIS_VERSION = "content-analysis-v1";
export const TRANSCRIPT_ANALYSIS_MAX_ATTEMPTS = 3;
export const TRANSCRIPT_ANALYSIS_CLAIM_TIMEOUT_MS = 10 * 60_000;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const SHA256_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

function rotateRight(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits));
}

/** Synchronous SHA-256 keeps this pure module usable by Node, browsers and Convex V8. */
export function hashTranscriptText(text: string) {
  const input = new TextEncoder().encode(text);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = input.length * 8;
  for (let index = 0; index < 8; index += 1) {
    padded[padded.length - 1 - index] = (bitLength / 2 ** (index * 8)) & 0xff;
  }

  const hash = SHA256_INITIAL.slice();
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = (padded[position] << 24) | (padded[position + 1] << 16) | (padded[position + 2] << 8) | padded[position + 3];
    }
    for (let index = 16; index < 64; index += 1) {
      const value = words[index - 15];
      const smallSigma0 = rotateRight(value, 7) ^ rotateRight(value, 18) ^ (value >>> 3);
      const previous = words[index - 2];
      const smallSigma1 = rotateRight(previous, 17) ^ rotateRight(previous, 19) ^ (previous >>> 10);
      words[index] = (words[index - 16] + smallSigma0 + words[index - 7] + smallSigma1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + bigSigma1 + choice + SHA256_K[index] + words[index]) | 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (bigSigma0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) | 0;
    }
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }
  return hash.map((value) => (value >>> 0).toString(16).padStart(8, "0")).join("");
}

export function analysisText(signal: Pick<SignalRecord, "transcript" | "transcriptWorkingCopy">) {
  const working = signal.transcriptWorkingCopy?.trim();
  if (working) return { text: signal.transcriptWorkingCopy!, textVersion: "working" as const };
  return signal.transcript?.trim()
    ? { text: signal.transcript, textVersion: "original" as const }
    : null;
}

export const TRANSCRIPT_ANALYSIS_FEATURES = [
  "hook",
  "tension",
  "loop",
  "proof",
  "example",
  "transition",
  "rhythm",
  "cta",
] as const;

export type TranscriptAnalysisResponse = {
  framework: TranscriptAnalysisFramework;
  findings: TranscriptAnalysisFinding[];
};

/** Builds the idempotent queue row for one finished Reel transcript. */
export function createTranscriptAnalysis(
  signal: Pick<SignalRecord, "id" | "format" | "transcript" | "transcriptWorkingCopy" | "transcriptStatus">,
  now: string,
  runId = `analysis-run-${hashTranscriptText(`${signal.id}\n${now}`)}`,
): TranscriptAnalysis | null {
  if (signal.format !== "reel") return null;
  if (signal.transcriptStatus !== undefined && signal.transcriptStatus !== "ready") return null;
  const source = analysisText(signal);
  if (!source) return null;
  const textHash = hashTranscriptText(source.text);
  return {
    id: `analysis-${signal.id}-${TRANSCRIPT_ANALYSIS_VERSION}-${textHash}`,
    signalId: signal.id,
    textVersion: source.textVersion,
    textHash,
    analysisVersion: TRANSCRIPT_ANALYSIS_VERSION,
    createdAt: now,
    runId,
    status: "queued",
    attempts: 0,
    framework: "none",
    findings: [],
    chunks: [],
    textLength: source.text.length,
    complete: false,
  };
}

/** Rechecks the persisted result at the storage boundary, after claim and text-hash checks. */
export function validateTranscriptAnalysisSettlement(result: import("./contracts.ts").SettleTranscriptAnalysis, text: string) {
  if (result.status === "failed") {
    if (!result.error?.trim() || result.error.length > 300) throw new Error("A failed analysis needs a bounded error.");
    return;
  }
  if (!result.framework || !result.findings || !result.chunks || result.textLength !== text.length || result.complete === undefined) {
    throw new Error("A complete analysis needs framework, findings, chunk coverage and text length.");
  }
  if (result.findings.length > 320) throw new Error("Analysis has too many findings.");
  for (const finding of result.findings) {
    if (!Number.isInteger(finding.start) || !Number.isInteger(finding.end) || finding.start < 0 || finding.end <= finding.start || text.slice(finding.start, finding.end) !== finding.quote) {
      throw new Error("Analysis contains a finding outside the selected text.");
    }
  }
  const chunks = [...result.chunks].sort((a, b) => a.index - b.index);
  if (chunks.length === 0 || chunks[0].start !== 0 || chunks.at(-1)?.end !== text.length || chunks.some((chunk, index) => (
    chunk.index !== index || chunk.end <= chunk.start || (index > 0 && chunk.start !== chunks[index - 1].end)
  ))) throw new Error("Analysis chunk coverage does not match the selected text.");
  if (result.complete !== chunks.every((chunk) => chunk.status === "complete")) throw new Error("Analysis completeness does not match its chunk coverage.");
}

/** Splits by UTF-16 positions without ever cutting a Unicode surrogate pair. */
export function chunkTranscript(text: string, maxChars = 4_000): TranscriptAnalysisChunk[] {
  if (!text) return [];
  const limit = Math.max(2, Math.floor(maxChars));
  const chunks: TranscriptAnalysisChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + limit);
    if (end < text.length && end > start && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end -= 1;
    if (end <= start) end = Math.min(text.length, start + limit);
    chunks.push({ index: chunks.length, start, end, text: text.slice(start, end) });
    start = end;
  }
  return chunks;
}

function boundedText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Validates model output against the exact chunk text supplied to the Bridge. */
export function parseTranscriptAnalysisResponse(value: unknown, text: string): TranscriptAnalysisResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Analysis response must be an object.");
  const input = value as Record<string, unknown>;
  if (input.framework !== "pas" && input.framework !== "bbb" && input.framework !== "none") {
    throw new Error("Analysis response has an invalid framework.");
  }
  if (!Array.isArray(input.findings)) throw new Error("Analysis response needs a findings list.");
  if (input.findings.length > 40) throw new Error("Analysis response has too many findings.");
  const findings = input.findings.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Finding ${index + 1} must be an object.`);
    const item = raw as Record<string, unknown>;
    if (!TRANSCRIPT_ANALYSIS_FEATURES.includes(item.feature as TranscriptAnalysisFeature)) {
      throw new Error(`Finding ${index + 1} has an unknown feature.`);
    }
    const explanation = boundedText(item.explanation, 600);
    const quote = typeof item.quote === "string" ? item.quote : "";
    const start = item.start;
    const end = item.end;
    if (!explanation || !quote) throw new Error(`Finding ${index + 1} needs explanation and quote.`);
    if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
      throw new Error(`Finding ${index + 1} has an invalid position.`);
    }
    if (text.slice(start, end) !== quote) throw new Error(`Finding ${index + 1} quote is not literal source text.`);
    return { feature: item.feature, explanation, quote, start, end } as TranscriptAnalysisFinding;
  });
  return { framework: input.framework, findings };
}

export function timecodeForFinding(
  finding: TranscriptAnalysisFinding,
  analyzedText: string,
  originalText: string,
  segments: readonly TranscriptSegment[] = [],
): Pick<TranscriptSegment, "start" | "end"> | undefined {
  if (!finding.quote || finding.end <= finding.start || analyzedText.slice(finding.start, finding.end) !== finding.quote) return undefined;
  const occurrences = (text: string, needle: string) => {
    const positions: number[] = [];
    let from = 0;
    while (needle && from <= text.length - needle.length) {
      const position = text.indexOf(needle, from);
      if (position < 0) break;
      positions.push(position);
      from = position + needle.length;
    }
    return positions;
  };
  const ranges = analyzedText === originalText
    ? [{ start: finding.start, end: finding.end }]
    : occurrences(originalText, finding.quote).map((start) => ({ start, end: start + finding.quote.length }));
  if (ranges.length !== 1) return undefined;
  const [range] = ranges;
  const candidates = segments.flatMap((segment) => {
    if (!segment.text.trim() || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start) return [];
    return occurrences(originalText, segment.text)
      .filter((segmentStart) => range.start >= segmentStart && range.end <= segmentStart + segment.text.length)
      .map(() => ({ start: segment.start, end: segment.end }));
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

export type TranscriptAnalysisAction =
  | { action: "run"; signalId: string }
  | { action: "retry"; analysisId: string }
  | { action: "catch-up"; limit: number; cursor?: string }
  | { action: "process"; limit: number };

function requiredId(value: unknown, name: string) {
  const id = typeof value === "string" ? value.trim().slice(0, 240) : "";
  if (!id) throw new Error(`${name} is required.`);
  return id;
}

function optionalId(value: unknown, name: string) {
  return value === undefined ? undefined : requiredId(value, name);
}

function boundedLimit(value: unknown, fallback: number) {
  const limit = value === undefined ? fallback : value;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 20) throw new Error("limit must be an integer from 1 to 20.");
  return limit as number;
}

/** Validates the narrow server-side queue and worker command surface. */
export function parseTranscriptAnalysisAction(value: unknown): TranscriptAnalysisAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be an object.");
  const input = value as Record<string, unknown>;
  if (input.action === "run") return { action: "run", signalId: requiredId(input.signalId, "signalId") };
  if (input.action === "retry") return { action: "retry", analysisId: requiredId(input.analysisId, "analysisId") };
  if (input.action === "catch-up") {
    const cursor = optionalId(input.cursor, "cursor");
    return { action: "catch-up", limit: boundedLimit(input.limit, 20), ...(cursor ? { cursor } : {}) };
  }
  if (input.action === "process") return { action: "process", limit: boundedLimit(input.limit, 3) };
  throw new Error("action must be run, retry, catch-up or process.");
}

export type TranscriptAnalysisView = {
  status: "empty" | "queued" | "running" | "complete" | "failed" | "stale";
  analysis?: TranscriptAnalysis;
};

/** Picks the current job, while retaining the newest older result as visible stale evidence. */
export function transcriptAnalysisView(
  signal: Pick<SignalRecord, "id" | "transcript" | "transcriptWorkingCopy">,
  analyses: readonly TranscriptAnalysis[],
): TranscriptAnalysisView {
  const source = analysisText(signal);
  const ordered = [...analyses].filter((item) => item.signalId === signal.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!source) return { status: "empty" };
  const hash = hashTranscriptText(source.text);
  const current = ordered.find((item) => item.textHash === hash && item.analysisVersion === TRANSCRIPT_ANALYSIS_VERSION);
  if (current) return { status: current.status, analysis: current };
  return ordered[0] ? { status: "stale", analysis: ordered[0] } : { status: "empty" };
}
