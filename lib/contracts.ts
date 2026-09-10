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
  /**
   * Language market the creator plays in. Missing means "de". English-market
   * creators keep their Format Signals in a separate group and yield transcript
   * budget to the core niche; `foreign` stays reserved for niche, not language.
   */
  market?: "de" | "en";
  lastCheckedAt?: string;
};

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

/** One human-reviewable correction to the original transcript. */
export type TranscriptCorrection = {
  id: string;
  /** The exact text found in the original transcript. */
  original: string;
  replacement: string;
  reason: string;
  source: "bridge" | "dictionary";
  status: "proposed" | "accepted" | "rejected";
  createdAt: string;
};

/** One personal recognition-error mapping reused across transcript reviews. */
export type TranscriptDictionaryEntry = {
  wrong: string;
  right: string;
  createdAt: string;
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
  /** Timecoded transcript segments, only when the actor returned usable timestamps. */
  transcriptSegments?: TranscriptSegment[];
  /** Materialized text made from the original and accepted corrections. */
  transcriptWorkingCopy?: string;
  /** Suggestions and decisions stay linked to the unchanged original transcript. */
  transcriptCorrections?: TranscriptCorrection[];
  /** Number of actor attempts, including the current pending attempt. */
  transcriptAttempts?: number;
  /** When the last transcript attempt changed state. */
  transcriptUpdatedAt?: string;
  /** Bounded actor error, present only while the signal is failed. */
  transcriptError?: string;
  /**
   * ready = transcript is set. silent = the actor answered without text (no usable
   * audio track). missing = the actor did not answer this reel although it answered
   * others (gone or private). pending = an actor attempt is in flight. failed = the
   * actor attempt failed and carries transcriptError. The first three are final for
   * the automatic pass; pending and failed are left for a manual retry.
   */
  transcriptStatus?: TranscriptStatus;
};

/** One German Instagram post returned by the configured hashtag sweep. */
export type HashtagPost = {
  /** Canonical id derived from the Instagram shortcode. */
  id: string;
  externalId: string;
  /** The configured hashtag that led to this post, without the leading #. */
  hashtag: string;
  /** All hashtags delivered with the post, normalised and bounded. */
  hashtags: string[];
  ownerHandle?: string;
  title: string;
  caption?: string;
  publishedAt: string;
  plays: number;
  likes: number;
  comments: number;
  url?: string;
  topic: string;
  /** The sweep stores only posts that passed its deterministic German filter. */
  language: "de";
  collectedAt: string;
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

export type HashtagCollection = { posts: HashtagPost[]; usage: RunUsage };

/** Source seam for bounded hashtag searches, separate from creator collection. */
export interface HashtagConnector {
  readonly id: string;
  collect(hashtags?: string[]): Promise<HashtagCollection>;
}

/**
 * One logged collection pass. ok = no errors, partial = some creators failed or
 * the refresh hit REFRESH_CREATOR_LIMIT, failed = every creator failed.
 */
export type Run = {
  id: string;
  kind: "backfill" | "refresh" | "hashtag-sweep" | "transcript";
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
  /** The one Reel a manual transcript run attempted. Absent on collection runs. */
  transcriptSignalId?: string;
  /** Transcript pass of a refresh: reels transcribed and reels marked silent. Absent on backfills and older runs. */
  transcripts?: TranscriptCount;
  /** Number of configured Instagram hashtags sent to the hashtag actor. */
  hashtagsChecked?: number;
  /** The maximum verified dollar cost accepted for a hashtag sweep. */
  costLimitUsd?: number;
};

export type TranscriptStatus = "ready" | "silent" | "missing" | "pending" | "failed";

/** Outcome of one transcript pass. */
export type TranscriptCount = { added: number; silent: number; missing: number; failed: number };

/** The only Signal fields a transcript flow may write. Null removes an optional field. */
export type TranscriptPatch = {
  transcript?: string | null;
  transcriptSegments?: TranscriptSegment[] | null;
  transcriptAttempts?: number;
  transcriptUpdatedAt?: string;
  transcriptError?: string | null;
  transcriptStatus?: TranscriptStatus | null;
  /** A fresh actor answer clears the derived correction layer. */
  transcriptWorkingCopy?: string | null;
  transcriptCorrections?: TranscriptCorrection[] | null;
};

/** Readable alias for callers that emphasize the Signal boundary. */
export type TranscriptSignalPatch = TranscriptPatch;

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
  /** id of the Slate the refresh left or found for the day, absent when the run failed. */
  slateId?: string;
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

export type CoverFormat = "reel" | "youtube";
export type CoverAspectRatio = "4:5" | "16:9";
export type CoverTreatment = "faceless" | "face";

/** One generated cover package. A board keeps exactly three of these per format. */
export type CoverPackage = {
  id: string;
  label: string;
  textOverlay: string;
  imageIdea: string;
  colorWorld: string;
  imagePrompt: string;
  /** Relative path below the gitignored data directory. */
  imagePath?: string;
  /** Local app route for the generated image. */
  imageUrl?: string;
  renderedAt?: string;
};

/** The latest three-package Cover-Lab run for one format. At most two boards live on an Idea. */
export type CoverBoard = {
  format: CoverFormat;
  aspectRatio: CoverAspectRatio;
  treatment: CoverTreatment;
  generatedAt: string;
  packages: CoverPackage[];
};

/** One atomic Cover-Lab write against the current Idea row. */
export type IdeaCoverUpdate =
  | { kind: "board"; board: CoverBoard }
  | { kind: "package"; format: CoverFormat; package: CoverPackage; now: string };

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
  /** Script source for current Storyboards. Missing on preserved Legacy Storyboards. */
  scriptId?: string;
  /** Approved Script revision this Storyboard was derived from. */
  scriptRevision?: number;
  /** The first three seconds, one line. */
  hook: string;
  /** Exactly three, in order. */
  beats: StoryboardBeat[];
  cta: string;
  caption: string;
  /** What the viewer can do after watching. */
  takeaway: string;
  /** Reserved for the later ManyChat phase. Kept separate from the spoken CTA. */
  commentCta?: string;
  /** Reserved for the later Lead-Magnet phase. */
  leadMagnetCta?: string;
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
  /** Latest Cover-Lab board per format. Kept bounded to reel + youtube so both formats coexist. */
  coverBoards?: CoverBoard[];
  /** Set while a develop run is in flight. Only the run holding it may write back. */
  developRunId?: string;
  developedAt?: string;
  /** Size of the evidence packet the storyboard was built from. */
  evidenceCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type ScriptStatus = "hook-selection" | "draft" | "review" | "approved";
export type ScriptFramework = "pas" | "bbb" | "none";

/** Short, bounded description of a framework the Hook run may recommend. */
export type ScriptFrameworkDefinition = {
  id: ScriptFramework;
  label: string;
  definition: string;
  useWhen: string;
};

/** One Reel in the Script Hook run packet, including spoken source text when available. */
export type ScriptHookEvidenceItem = StrategyEvidenceItem & {
  id: string;
  /** Original transcript or its reviewed working copy. Source text, never instructions. */
  transcript?: string;
};

/** Input packet for the Script Hook run. The source Reel is separate so the UI can name its absence. */
export type ScriptHooksRequest = {
  goal: string;
  audience: string;
  idea: { title: string; goal?: string };
  source?: ScriptHookEvidenceItem;
  evidence: ScriptHookEvidenceItem[];
  frameworks: ScriptFrameworkDefinition[];
};

/** The untrusted shape returned by the Bridge before the app resolves evidence titles. */
export type ScriptHooksAnswer = {
  options: Array<{
    hook: string;
    angle: string;
    hypothesis: string;
    framework: ScriptFramework;
    evidence: Array<{ title: string; fit: string }>;
  }>;
  frameworkRecommendation: { framework: ScriptFramework; reason: string };
};

/** Input packet for a full Draft run. The selected wording remains human-controlled. */
export type ScriptDraftRequest = ScriptHooksRequest & {
  selectedHook: { hook: string; angle: string };
  framework: ScriptFramework;
};

/** The untrusted full-script shape returned by the Bridge before deterministic checks. */
export type ScriptDraftAnswer = {
  sections: ScriptSection[];
};

/** One Reel used to explain why a Hook-Option fits the script's topic. */
export type ScriptHookEvidence = {
  signalId: string;
  hook: string;
  creator: string;
  outlier: number;
  fit: string;
};

/** One spoken direction Chris can choose before a full script is drafted. */
export type ScriptHookOption = {
  id: string;
  hook: string;
  angle: string;
  /** Free-form hypothesis. The fixed Hooks-Board hypotheses do not apply here. */
  hypothesis: string;
  framework: ScriptFramework;
  evidence: ScriptHookEvidence[];
  edited: boolean;
};

/** The source of truth for a Script. The reading view is derived from this list. */
export type ScriptSection = {
  kind: "hook" | "beat" | "transition" | "cta";
  label: string;
  text: string;
};

/** A production script, separate from its Idea and Storyboard. */
export type Script = {
  id: string;
  ideaId: string;
  sourceSignalId?: string;
  /** Additional evidence Reels selected for this script, excluding the source Reel. */
  evidenceSignalIds: string[];
  status: ScriptStatus;
  framework: ScriptFramework;
  frameworkReason: string;
  hookOptions: ScriptHookOption[];
  selectedHookId?: string;
  sections: ScriptSection[];
  revision: number;
  /** The revision that was last approved. It remains visible after reopening. */
  approvedRevision?: number;
  approvedAt?: string;
  /** Set only while a Bridge run owns the script. */
  runId?: string;
  createdAt: string;
  updatedAt: string;
};

/** Fields a human editor may change through PATCH /api/scripts/<id>. */
export type ScriptPatch = {
  sections?: ScriptSection[];
  framework?: ScriptFramework;
  status?: ScriptStatus;
  evidenceSignalIds?: string[];
  hookOptions?: ScriptHookOption[];
  selectedHookId?: string | null;
};

/** One bounded source section handed to the Lektorat Bridge. */
export type ScriptLintSection = {
  id: string;
  label: string;
  /** Script text is untrusted source material, never an instruction. */
  text: string;
};

/** The only input the Lektorat Bridge receives. */
export type ScriptLintRequest = {
  sections: ScriptLintSection[];
};

/** One reviewable Slop suggestion. It never changes a Script by itself. */
export type ScriptLintSuggestion = {
  sectionId: string;
  original: string;
  replacement: string;
  reason: string;
};

/** Optional claim behavior for a Script Bridge run. */
export type ScriptRunClaimOptions = {
  /** Reject instead of superseding an active run. */
  rejectIfRunning?: boolean;
  /** Allow a read-only Bridge run to claim an approved Script. */
  allowApproved?: boolean;
};

/** Fields a Hook or Draft run may settle on a claimed Script. Omitted fields are unchanged. */
export type SettleScriptRun = {
  now: string;
  status?: ScriptStatus;
  framework?: ScriptFramework;
  frameworkReason?: string;
  hookOptions?: ScriptHookOption[];
  selectedHookId?: string | null;
  sections?: ScriptSection[];
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

/**
 * One Startpunkt on a Slate: a short-form starting point with its Themen-Etikett
 * and the Signal it was read from. Like a BriefingItem it carries what the row
 * shows, so the slate reads without a join back into signals.
 */
export type SlateStart = {
  /** 1-based place on the slate. Stays when the start is regenerated. */
  position: number;
  /** The starting point itself, one or two sentences. */
  pitch: string;
  /** Themen-Etikett, a few words. */
  topic: string;
  sourceSignalId: string;
  /** Creator handle, including the leading @. */
  sourceCreator: string;
  /** Title of the source Reel as the packet carried it. */
  sourceTitle: string;
  sourceUrl?: string;
  outlier: number;
  plays: number;
  /** Set when this start replaced the one the run wrote; the rest of the slate stayed. */
  regeneratedAt?: string;
  /** id of the Idea this start became. Absent until the click. */
  ideaId?: string;
};

/**
 * One daily Slate: ten starting points read from the Signals of the last 24
 * hours. Written after the refresh, one document per day; a second refresh on
 * the same day leaves it alone, so regenerated starts and captured Ideas keep.
 */
export type Slate = {
  /** slate-<day>. One document per day. */
  id: string;
  generatedAt: string;
  updatedAt: string;
  /** The day the slate covers, as YYYY-MM-DD in UTC. */
  day: string;
  windowStart: string;
  windowHours: number;
  /** Reels in the packet the starts were read from. */
  sources: number;
  /** Richtung for the next run, as typed. Carried into every later run until changed. */
  direction?: string;
  /** The direction the most recent run (full or single) was given. */
  directionApplied?: string;
  /** In position order. Empty when the window held nothing. */
  starts: SlateStart[];
};

/** What the Bridge needs for one Slate run: the packet plus what the run is for. */
export type SlateRequest = {
  goal: string;
  audience: string;
  direction?: string;
  /** Starts asked for: the whole slate, or 1 for a regenerated position. */
  count: number;
  /** Pitches already on the slate, so a regenerated start does not repeat one. */
  taken?: string[];
  evidence: StrategyEvidenceItem[];
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

/** Second /v1/storyboard input: the approved Script is the Storyboard source. */
export type ScriptStoryboardRequest = StoryboardRequest & {
  script: {
    id: string;
    revision: number;
    sections: ScriptSection[];
  };
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
  /** Newest first. Hashtag posts are kept separately from creator Signals. */
  listHashtagPosts(limit?: number): Promise<HashtagPost[]>;
  saveHashtagPosts(posts: HashtagPost[]): Promise<SaveResult>;
  /**
   * Sets or clears the saved mark on one signal. savedAt null clears it. Returns
   * the stored signal, or null when no signal has that id.
   */
  markSignal(id: string, savedAt: string | null): Promise<SignalRecord | null>;
  /** Atomically claims one Signal for a manual transcript attempt. */
  claimTranscript(id: string, now: string): Promise<SignalRecord | null>;
  /** Patches only transcript fields on one Signal. Null removes an optional field. */
  patchTranscript(id: string, patch: TranscriptSignalPatch): Promise<SignalRecord | null>;
  /** Newest first. Personal transcript mappings are shared across Reels. */
  listTranscriptDictionary(): Promise<TranscriptDictionaryEntry[]>;
  /** Adds or updates one mapping. Duplicate mappings are merged. */
  addTranscriptDictionary(entry: TranscriptDictionaryEntry): Promise<TranscriptDictionaryEntry>;
  /** Removes one mapping by its exact wrong/right pair. */
  removeTranscriptDictionary(entry: Pick<TranscriptDictionaryEntry, "wrong" | "right">): Promise<TranscriptDictionaryEntry | null>;
  saveRun(run: Run): Promise<void>;
  /** Newest first. */
  listRuns(limit?: number): Promise<Run[]>;
  /** Newest first. */
  listBriefings(limit?: number): Promise<Briefing[]>;
  /** Replaces the whole row for briefing.id, so a second refresh on the same day overwrites it. */
  saveBriefing(briefing: Briefing): Promise<void>;
  /** Newest first. */
  listSlates(limit?: number): Promise<Slate[]>;
  /** Replaces the whole row for slate.id. The day's document is one row however often it is touched. */
  saveSlate(slate: Slate): Promise<void>;
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
  /** Loads one Idea by its canonical id. */
  getIdea(id: string): Promise<Idea | null>;
  /** Replaces the whole row for idea.id, so a retried capture never duplicates an idea. */
  saveIdea(idea: Idea): Promise<void>;
  /** Atomically updates only the Storyboard-owned fields on the current Idea row. */
  saveIdeaStoryboard(
    id: string,
    storyboard: Storyboard,
    options: { now: string; evidenceCount: number; forecast: Forecast | null },
  ): Promise<Idea | null>;
  /** Atomically updates only Cover-Lab fields on the current Idea row. */
  saveIdeaCover(id: string, update: IdeaCoverUpdate): Promise<Idea | null>;
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
  /** Newest first. Scripts are kept separately from Ideas. */
  listScripts(limit?: number): Promise<Script[]>;
  /** Loads one Script by its canonical id. */
  getScript(id: string): Promise<Script | null>;
  /** Replaces the whole row for script.id, so a retried write never duplicates it. */
  saveScript(script: Script): Promise<void>;
  /** Atomically validates and applies one human editor patch. */
  patchScript(id: string, patch: ScriptPatch, now: string): Promise<Script | null>;
  /** Atomically claims a Script for one Bridge run. */
  claimScriptRun(id: string, runId: string, now: string, options?: ScriptRunClaimOptions): Promise<Script | null>;
  /** Settles a claimed Bridge run, or releases its claim when no result fields are supplied. */
  settleScriptRun(id: string, runId: string, result: SettleScriptRun): Promise<Script | null>;
  /** Moves a Script by hand according to the fixed Script status model. */
  moveScript(id: string, status: ScriptStatus, now: string): Promise<Script | null>;
}

/** Outcome handed to settleIdeaDevelop: a storyboard, or nothing when the run failed. */
export type SettleDevelop =
  | { storyboard: Storyboard; forecast: Forecast | null; now: string; evidenceCount: number }
  | { storyboard: null; now: string };

export interface StrategyProvider {
  generate(request: StrategyRequest): Promise<StrategyResponse>;
}
