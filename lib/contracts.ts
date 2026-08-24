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

export type RefreshResult = {
  creatorsChecked: number;
  recordsAdded: number;
  completedAt: string;
  covers?: CoverCacheResult;
  errors?: string[];
};

export type StrategyRequest = {
  goal: string;
  audience: string;
  evidence: Array<{ title: string; topic: string; score: number }>;
};

export type StrategyResponse = {
  angle: string;
  rationale: string;
  opening: string;
  proofToShow: string[];
  cautions: string[];
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
  saveSignals(records: SignalRecord[]): Promise<void>;
}

export interface StrategyProvider {
  generate(request: StrategyRequest): Promise<StrategyResponse>;
}
