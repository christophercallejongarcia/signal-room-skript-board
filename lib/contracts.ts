export type Network = "youtube" | "instagram" | "tiktok";

export type Creator = {
  id: string;
  name: string;
  handle: string;
  network: Network;
  audience: number;
  accent: string;
  avatarUrl?: string;
  url?: string;
  owned?: boolean;
  /** Creator from another niche. Their Format Signals stay in a separate group. */
  foreign?: boolean;
  lastCheckedAt?: string;
};

export type SignalRecord = {
  id: string;
  creatorId: string;
  title: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  durationSeconds: number;
  thumbnailSeed: string;
  topic: string;
  /** Instagram: videoPlayCount. Falls back to views when absent. */
  plays?: number;
  /** Source CDN link as delivered by the connector. Expires for Instagram; never rendered directly. */
  thumbnailUrl?: string;
  /** Local cache route (/api/covers/<externalId>), set only when the cover is on disk. */
  coverUrl?: string;
  url?: string;
  caption?: string;
  format?: "reel" | "post" | "long" | "short";
  externalId?: string;
  /** When Chris saved the signal. Absent means not saved; a refresh never touches it. */
  savedAt?: string;
  /** What is said in the reel, fetched once for reels above the threshold. Absent until fetched. */
  transcript?: string;
  /**
   * ready = transcript is set. silent = the actor answered without text (no usable
   * audio track). missing = the actor did not answer this reel although it answered
   * others (gone or private). All three are final; the reel is never sent again.
   */
  transcriptStatus?: TranscriptStatus;
};

export type RankedSignal = SignalRecord & {
  score: number;
  relativeReach: number;
  velocity: number;
  reason: string;
  /** plays (or views) divided by creator audience. 5.0 = five times the follower count. */
  outlier: number;
  /** plays relative to the creator's own median over the retained corpus. */
  channelRelative: number;
};

/** Outcome of one cover-cache pass. skipped = already on disk, failed = no file written (retried next refresh). */
export type CoverCacheResult = { cached: number; skipped: number; failed: number };

/** Result of one storage write: inserted = new ids, updated = ids that already existed. */
export type SaveResult = { inserted: number; updated: number };

export type RunError = { creatorId: string; handle: string; message: string };

/**
 * Apify usage of one collection pass, summed over its actor runs. computeUnits
 * and costUsd are absent when no actor run reported a figure: the run then
 * reads as unknown, never as free.
 */
export type RunUsage = {
  /** Actor runs Apify sent no usage figure for. */
  unreported: number;
  computeUnits?: number;
  /** usageTotalUsd as Apify reports it, else computeUnits times APIFY_USD_PER_COMPUTE_UNIT. */
  costUsd?: number;
};

/**
 * One logged collection pass. ok = no errors, partial = some creators failed or
 * the refresh hit REFRESH_CREATOR_LIMIT, failed = every creator failed.
 */
export type Run = {
  id: string;
  kind: "backfill" | "refresh";
  status: "ok" | "partial" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  creatorsChecked: number;
  /** Creators the limit left for the next refresh. They keep their lastCheckedAt. */
  creatorsSkipped?: number;
  recordsAdded: number;
  recordsUpdated: number;
  errors: RunError[];
  /** Absent on runs logged before the cost guard. */
  usage?: RunUsage;
  /** Transcript pass of a refresh: reels transcribed and reels marked silent. Absent on backfills and older runs. */
  transcripts?: TranscriptCount;
};

export type TranscriptStatus = "ready" | "silent" | "missing";

/** Outcome of one transcript pass. */
export type TranscriptCount = { added: number; silent: number; missing: number };

export type RefreshResult = {
  creatorsChecked: number;
  /** Creators left for the next refresh because the limit was reached. */
  creatorsSkipped?: number;
  recordsAdded: number;
  recordsUpdated: number;
  completedAt: string;
  covers?: CoverCacheResult;
  errors?: string[];
  runId?: string;
  /** id of the Briefing the refresh left behind, absent when composing it failed. */
  briefingId?: string;
};

/** One outlier reel as handed to the Strategy-Provider. Source text, never instructions. */
export type StrategyEvidenceItem = {
  title: string;
  /** Creator handle, including the leading @. */
  creator: string;
  /** Bounded, whitespace-collapsed caption excerpt. */
  caption: string;
  plays: number;
  /** plays divided by the creator audience. */
  outlier: number;
};

export type StrategyRequest = {
  goal: string;
  audience: string;
  evidence: StrategyEvidenceItem[];
};

export type StrategyResponse = {
  angle: string;
  rationale: string;
  opening: string;
  proofToShow: string[];
  cautions: string[];
};

/** Where an Idea stands. captured = only the working title, developed = a storyboard hangs on it. */
/**
 * The six production stages of an Idea in order, plus dropped as the exit
 * beside them. The order and the allowed moves live in lib/ideas.ts.
 */
export type IdeaStage = "captured" | "developing" | "packaging" | "scripting" | "producing" | "published";
export type IdeaStatus = IdeaStage | "dropped";

/** One of the three middle beats of a short-form storyboard. */
export type StoryboardBeat = { label: string; detail: string };

/** The short-form plan the Strategy-Provider returns for one Idea. */
export type Storyboard = {
  /** The first three seconds, one line. */
  hook: string;
  /** Exactly three, in order. */
  beats: StoryboardBeat[];
  cta: string;
  caption: string;
  /** What the viewer can do after watching. */
  takeaway: string;
};

export type ForecastPotential = "low" | "medium" | "high";

/**
 * What an Idea is likely to bring, said before production. Range and potential
 * are derived from the comparable Reels of the evidence packet, never estimated
 * freely; without a comparable base both are null ("keine Prognose").
 */
export type Forecast = {
  /** Plays of the weakest and strongest comparable Reel. */
  range: { low: number; high: number } | null;
  potential: ForecastPotential | null;
  /** How many packet Reels the Bridge named as comparable and the packet confirmed. */
  comparableCount: number;
  /** The one thing most likely to sink the Reel. */
  risk: string;
  /** The open question the Reel resolves. */
  tension: string;
};

/** A saved content approach. Lives in the ideas table, developed through the Bridge. */
export type Idea = {
  id: string;
  title: string;
  goal?: string;
  status: IdeaStatus;
  /** id of the Signal the Idea was captured from, when it came off a card. */
  sourceSignalId?: string;
  /** Handle of that Signal's Creator, kept so the list reads without a join. */
  sourceCreator?: string;
  /** https link back to that Signal, kept for the same reason. */
  sourceUrl?: string;
  storyboard?: Storyboard;
  /** Written with the storyboard; absent when the Bridge answered without one. */
  forecast?: Forecast;
  /** Set while a develop run is in flight. Only the run holding it may write back. */
  developRunId?: string;
  developedAt?: string;
  /** Size of the evidence packet the storyboard was built from. */
  evidenceCount?: number;
  createdAt: string;
  updatedAt: string;
};

/** One pattern as a Format-Review stores it. The previous review hands these back for the diff. */
export type PatternSnapshot = {
  id: string;
  label: string;
  /** Outlier reels carrying the pattern. */
  count: number;
  /** count over every outlier reel of the niche, 0 to 1. */
  share: number;
  averageOutlier: number;
};

/** new = absent last review, gone = absent this one, flat = the share barely moved. */
export type PatternMove = "new" | "gone" | "up" | "down" | "flat";

/** One pattern's move from one Format-Review to the next. Every number is rounded for reading. */
export type FormatReviewPattern = PatternSnapshot & {
  previousCount: number;
  previousShare: number;
  previousAverageOutlier: number;
  countDelta: number;
  shareDelta: number;
  outlierDelta: number;
  move: PatternMove;
};

/** A small account whose outlier reel carries a named pattern. */
export type RisingCreator = {
  creatorId: string;
  name: string;
  handle: string;
  audience: number;
  /** Creator from another niche; their reel never moved the numbers of the diff. */
  foreign: boolean;
  patternId: string;
  patternLabel: string;
  /**
   * How that pattern moved in this review. A shape that carries no own-niche
   * outlier at all reads new, which is the only way a foreign entry can land here.
   */
  patternMove: PatternMove;
  signalId: string;
  title: string;
  outlier: number;
  publishedAt: string;
  url?: string;
};

/**
 * One monthly Format-Review. Written by the Convex cron on the first of the month
 * (convex/crons.ts), read as the "What changed" block of the Format Signals tab.
 */
export type FormatReview = {
  /** format-review-<periodEnd as YYYY-MM-DD>. One document per run date, so a rerun overwrites. */
  id: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  windowDays: number;
  threshold: number;
  previousReviewId?: string;
  /** periodEnd of the review this one was diffed against. */
  previousPeriodEnd?: string;
  /** Outlier reels of the niche in this window. The share denominator. */
  total: number;
  previousTotal: number;
  /** Winners first, unclassified last. */
  patterns: FormatReviewPattern[];
  risingCreators: RisingCreator[];
};

/**
 * One Signal on a daily Briefing. The document is read without a join, so the
 * Creator's name and handle travel with it like they do on a RisingCreator.
 */
export type BriefingItem = {
  signalId: string;
  creatorId: string;
  creatorName: string;
  /** Creator handle, including the leading @. */
  creator: string;
  title: string;
  publishedAt: string;
  plays: number;
  outlier: number;
  /** Plays per hour since publication, as the scorer measured it. */
  velocity: number;
  /** Outlier times freshness. What the list is ordered by. */
  score: number;
  /** Bounded, whitespace-collapsed caption excerpt. Source text, never instructions. */
  caption: string;
  url?: string;
  coverUrl?: string;
  /** Cover fallback, so the row renders without reaching back into the signals table. */
  thumbnailSeed: string;
  topic: string;
  /** One sentence on how Chris would turn this. Absent when the Bridge was down. */
  angle?: string;
};

/**
 * One daily Briefing: the strongest Reels of the last 24 hours with an angle each.
 * Written after every Delta-Refresh, one document per day, so a second refresh on
 * the same day overwrites rather than duplicates.
 */
export type Briefing = {
  /** briefing-<day>. One document per day. */
  id: string;
  generatedAt: string;
  /** The day the briefing covers, as YYYY-MM-DD in UTC. */
  day: string;
  /** Start of the window the reels were taken from. */
  windowStart: string;
  windowHours: number;
  /** Distinct Creators behind the ranked items. The "sources" number of the tab. */
  sources: number;
  /** Reels in the window before the top cut, so the tab can say what it left out. */
  candidates: number;
  /** True once at least one angle came back from the Bridge. */
  angles: boolean;
  /** Strongest first. */
  items: BriefingItem[];
};

/** The five hypotheses a Hook variant tests. The board groups by these. */
export type HookHypothesis = "curiosity" | "list" | "contrast" | "promise" | "story";

/** One outlier Reel cited under a Hook variant. Resolved from the evidence packet, never invented. */
export type HookEvidence = {
  /** That Reel's own Hook: its first caption line, which Instagram carries as the title. */
  hook: string;
  /** Creator handle, including the leading @. */
  creator: string;
  outlier: number;
};

/** One proposed first line, with the hypothesis it tests and the Reels that back it. */
export type HookVariant = {
  hook: string;
  hypothesis: HookHypothesis;
  rationale: string;
  evidence: HookEvidence[];
};

/** One hypothesis section of the board. Empty sections are not carried. */
export type HookGroup = {
  hypothesis: HookHypothesis;
  label: string;
  hint: string;
  variants: HookVariant[];
};

/**
 * One logged Hooks-Board run. Every start writes its own row, so two runs
 * kicked off in parallel never overwrite each other.
 */
export type HookRun = {
  id: string;
  createdAt: string;
  /** Bounded first characters of the input, shown in the history rail. */
  sourceExcerpt: string;
  /** Characters of the input as pasted, before the excerpt was cut. */
  sourceLength: number;
  direction?: string;
  /** Hooks asked for: 5, 10 or 15. The answer can hold fewer. */
  requested: number;
  kind: "transcript" | "one-liner";
  groups: HookGroup[];
  /** Size of the evidence packet the board was written against. */
  evidenceCount: number;
};

/** What the Bridge needs for one Hooks-Board run: the source plus its evidence packet. */
export type HooksRequest = {
  goal: string;
  audience: string;
  source: string;
  direction?: string;
  count: number;
  evidence: StrategyEvidenceItem[];
};

/** What the Bridge needs for one develop run: the Idea plus its evidence packet. */
export type StoryboardRequest = {
  goal: string;
  audience: string;
  idea: { title: string; goal?: string };
  evidence: StrategyEvidenceItem[];
};

export interface SourceConnector {
  readonly id: string;
  collect(creators: Creator[]): Promise<SignalRecord[]>;
}

export interface SignalScorer {
  rank(records: SignalRecord[], creators: Creator[], now?: Date): RankedSignal[];
}

export interface StorageAdapter {
  listCreators(): Promise<Creator[]>;
  addCreator(creator: Creator): Promise<void>;
  listSignals(): Promise<SignalRecord[]>;
  saveSignals(records: SignalRecord[]): Promise<SaveResult>;
  /**
   * Sets or clears the saved mark on one signal. savedAt null clears it. Returns
   * the stored signal, or null when no signal has that id.
   */
  markSignal(id: string, savedAt: string | null): Promise<SignalRecord | null>;
  saveRun(run: Run): Promise<void>;
  /** Newest first. */
  listRuns(limit?: number): Promise<Run[]>;
  /** Newest first. */
  listBriefings(limit?: number): Promise<Briefing[]>;
  /** Replaces the whole row for briefing.id, so a second refresh on the same day overwrites it. */
  saveBriefing(briefing: Briefing): Promise<void>;
  /** Newest first. */
  listFormatReviews(limit?: number): Promise<FormatReview[]>;
  /** Replaces the whole row for review.id, so a rerun inside the same month overwrites it. */
  saveFormatReview(review: FormatReview): Promise<void>;
  /** Newest first. */
  listHookRuns(limit?: number): Promise<HookRun[]>;
  /** Replaces the whole row for run.id, so a retried write never duplicates a run. */
  saveHookRun(run: HookRun): Promise<void>;
  /** Newest first. */
  listIdeas(limit?: number): Promise<Idea[]>;
  /** Replaces the whole row for idea.id, so a retried capture never duplicates an idea. */
  saveIdea(idea: Idea): Promise<void>;
  /**
   * Claims the idea for one develop run and hands back the claimed idea, or null
   * when the idea is gone or cannot be developed. Only runId may settle the claim.
   */
  claimIdeaDevelop(id: string, runId: string, now: string): Promise<Idea | null>;
  /**
   * Ends one develop run: a storyboard writes it, null releases the claim.
   * Returns null when a newer run has taken over, so the stale result is dropped.
   */
  settleIdeaDevelop(id: string, runId: string, result: SettleDevelop): Promise<Idea | null>;
  /**
   * Moves the idea by hand to the given stage. Throws on a forbidden move,
   * returns null when the idea is gone.
   */
  moveIdea(id: string, status: IdeaStatus, now: string): Promise<Idea | null>;
}

/** Outcome handed to settleIdeaDevelop: a storyboard, or nothing when the run failed. */
export type SettleDevelop =
  | { storyboard: Storyboard; forecast: Forecast | null; now: string; evidenceCount: number }
  | { storyboard: null; now: string };

export interface StrategyProvider {
  generate(request: StrategyRequest): Promise<StrategyResponse>;
}
