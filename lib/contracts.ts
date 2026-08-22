export type Network = "youtube" | "instagram" | "tiktok";

export type Creator = {
  id: string;
  name: string;
  handle: string;
  network: Network;
  audience: number;
  accent: string;
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
};

export type RankedSignal = SignalRecord & {
  score: number;
  relativeReach: number;
  velocity: number;
  reason: string;
};

export type RefreshResult = {
  creatorsChecked: number;
  recordsAdded: number;
  completedAt: string;
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
