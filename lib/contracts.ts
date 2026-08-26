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

/** One logged collection pass. ok = no errors, partial = some creators failed, failed = every creator failed. */
export type Run = {
  id: string;
  kind: "backfill" | "refresh";
  status: "ok" | "partial" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  creatorsChecked: number;
  recordsAdded: number;
  recordsUpdated: number;
  errors: RunError[];
};

export type RefreshResult = {
  creatorsChecked: number;
  recordsAdded: number;
  recordsUpdated: number;
  completedAt: string;
  covers?: CoverCacheResult;
  errors?: string[];
  runId?: string;
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
export type IdeaStatus = "captured" | "developed" | "produced" | "dropped";

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
  /** Set while a develop run is in flight. Only the run holding it may write back. */
  developRunId?: string;
  developedAt?: string;
  /** Size of the evidence packet the storyboard was built from. */
  evidenceCount?: number;
  createdAt: string;
  updatedAt: string;
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
  saveRun(run: Run): Promise<void>;
  /** Newest first. */
  listRuns(limit?: number): Promise<Run[]>;
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
}

/** Outcome handed to settleIdeaDevelop: a storyboard, or nothing when the run failed. */
export type SettleDevelop =
  | { storyboard: Storyboard; now: string; evidenceCount: number }
  | { storyboard: null; now: string };

export interface StrategyProvider {
  generate(request: StrategyRequest): Promise<StrategyResponse>;
}
