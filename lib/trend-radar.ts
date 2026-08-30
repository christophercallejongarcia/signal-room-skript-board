import { INSTAGRAM_HASHTAG_WINDOW_DAYS } from "./config.ts";
import { isOwned } from "./discover-filter.ts";
import type { Creator, HashtagPost, SignalRecord } from "./contracts";

const DAY = 86_400_000;

/** Rule-based topic vocabulary for the first Trend-Radar version. */
export const TOPIC_RULES = [
  {
    id: "ki-agenten",
    label: "KI-Agenten",
    keywords: ["kiagent", "ki-agent", "ki agent", "ai agent", "ai-agent", "agenten", "agent workflow"],
  },
  {
    id: "vibe-coding",
    label: "Vibe Coding",
    keywords: ["vibecoding", "vibe coding", "cursor", "lovable", "bolt.new", "replit"],
  },
  {
    id: "ki-tools",
    label: "KI-Tools",
    keywords: ["kitool", "ki-tool", "ki tool", "chatgpt", "claude", "gemini", "perplexity", "midjourney", "llm"],
  },
  {
    id: "automation",
    label: "Automatisierung",
    keywords: ["automatis", "workflow", "zapier", "make.com", "no-code", "nocode"],
  },
] as const;

export const OTHER_TOPIC = "other";

const topicLabels = new Map<string, string>([
  ...TOPIC_RULES.map((rule) => [rule.id, rule.label] as const),
  [OTHER_TOPIC, "Weitere KI-Themen"],
]);

const GERMAN_WORDS = new Set([
  "aber",
  "auch",
  "auf",
  "aus",
  "das",
  "der",
  "die",
  "du",
  "ein",
  "eine",
  "für",
  "ich",
  "im",
  "ist",
  "kann",
  "mit",
  "nicht",
  "nur",
  "oder",
  "sie",
  "und",
  "von",
  "warum",
  "wie",
  "wir",
  "zu",
]);

const ENGLISH_WORDS = new Set([
  "about",
  "and",
  "are",
  "for",
  "from",
  "how",
  "in",
  "is",
  "my",
  "of",
  "the",
  "this",
  "to",
  "what",
  "with",
]);

function normalise(text: string) {
  return text
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "");
}

/** A conservative language gate. Short captions without German evidence are left out. */
export function isGermanCaption(caption: string | undefined): boolean {
  const source = caption?.trim() ?? "";
  if (!source) return false;
  const words = source.toLocaleLowerCase("de-DE").match(/[\p{L}]+/gu) ?? [];
  const german = words.filter((word) => GERMAN_WORDS.has(word)).length;
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  const germanCharacter = /[äöüß]/i.test(source);
  return (german > english && german > 0) || (germanCharacter && english === 0);
}

/** Assigns a topic from hashtags and caption text. The first matching rule wins. */
export function classifyTopic(text: string): string {
  const source = normalise(text);
  return TOPIC_RULES.find((rule) => rule.keywords.some((keyword) => source.includes(normalise(keyword))))?.id ?? OTHER_TOPIC;
}

export function topicLabel(topic: string) {
  return topicLabels.get(topic) ?? topic;
}

export type TrendLead = {
  title: string;
  hashtag: string;
  plays: number;
  publishedAt: string;
  ownerHandle?: string;
  url?: string;
};

export type TrendTopic = {
  topic: string;
  label: string;
  hashtags: string[];
  currentPosts: number;
  previousPosts: number;
  currentPlays: number;
  previousPlays: number;
  /** Symmetric percentage movement, bounded to -100…100. */
  postsMomentum: number;
  playsMomentum: number;
  /** Mean of post and play momentum. */
  momentum: number;
  coveredCreators: number;
  trackedCreators: number;
  coverage: number;
  coverageGap: number;
  /** Positive momentum multiplied by the share of uncovered creators. */
  opportunity: number;
  lead: TrendLead;
  reason: string;
};

export type TrendRadar = {
  generatedAt: string;
  windowDays: number;
  sourceHashtags: string[];
  trackedCreators: number;
  topics: TrendTopic[];
};

export type TrendRadarOptions = {
  now?: number;
  windowDays?: number;
};

function finiteDate(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function inWindow(publishedAt: string, start: number, end: number) {
  const time = finiteDate(publishedAt);
  return time !== null && time >= start && time < end;
}

function movement(current: number, previous: number) {
  if (current === 0 && previous === 0) return 0;
  return Math.round(((current - previous) / Math.max(current, previous, 1)) * 1000) / 10;
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function signalTopic(signal: SignalRecord) {
  return classifyTopic([signal.topic, signal.title, signal.caption ?? ""].join(" "));
}

/**
 * Builds the Radar from the hashtag corpus and the stored creator Signals. It
 * never calls a provider and is therefore easy to test and safe to use in both
 * the file-store fallback and Convex route.
 */
export function buildTrendRadar(
  input: { posts: HashtagPost[]; signals: SignalRecord[]; creators: Creator[]; sourceHashtags?: string[] },
  options: TrendRadarOptions = {},
): TrendRadar {
  const now = options.now ?? Date.now();
  const windowDays = options.windowDays ?? INSTAGRAM_HASHTAG_WINDOW_DAYS / 2;
  const currentStart = now - windowDays * DAY;
  const previousStart = currentStart - windowDays * DAY;
  const tracked = input.creators.filter((creator) => creator.network === "instagram" && !isOwned(creator));
  const trackedIds = new Set(tracked.map((creator) => creator.id));
  const groups = new Map<string, { current: HashtagPost[]; previous: HashtagPost[] }>();

  for (const post of input.posts) {
    const current = inWindow(post.publishedAt, currentStart, now);
    const previous = inWindow(post.publishedAt, previousStart, currentStart);
    if (!current && !previous) continue;
    const group = groups.get(post.topic) ?? { current: [], previous: [] };
    if (current) group.current.push(post);
    else group.previous.push(post);
    groups.set(post.topic, group);
  }

  const coverageSignals = input.signals.filter((signal) => {
    if (!trackedIds.has(signal.creatorId)) return false;
    return inWindow(signal.publishedAt, previousStart, now);
  });

  const topics = [...groups.entries()]
    .filter(([, group]) => group.current.length > 0)
    .map(([topic, group]): TrendTopic => {
      const currentPlays = group.current.reduce((sum, post) => sum + post.plays, 0);
      const previousPlays = group.previous.reduce((sum, post) => sum + post.plays, 0);
      const postsMomentum = movement(group.current.length, group.previous.length);
      const playsMomentum = movement(currentPlays, previousPlays);
      const momentum = round((postsMomentum + playsMomentum) / 2);
      const coveredCreators = new Set(
        coverageSignals.filter((signal) => signalTopic(signal) === topic).map((signal) => signal.creatorId),
      ).size;
      const coverage = tracked.length === 0 ? 0 : round((coveredCreators / tracked.length) * 100) / 100;
      const coverageGap = round(1 - coverage);
      const opportunity = round(Math.max(0, momentum) * coverageGap);
      const leadPost = [...group.current].sort((a, b) => b.plays - a.plays)[0];
      const deltaPosts = group.current.length - group.previous.length;
      const deltaPlays = currentPlays - previousPlays;
      const coverageText = tracked.length === 0
        ? "Noch kein getrackter Instagram-Creator deckt das Thema ab."
        : `${coveredCreators} von ${tracked.length} getrackten Instagram-Creators decken das Thema ab.`;

      return {
        topic,
        label: topicLabel(topic),
        hashtags: [...new Set(group.current.flatMap((post) => post.hashtags))].sort(),
        currentPosts: group.current.length,
        previousPosts: group.previous.length,
        currentPlays,
        previousPlays,
        postsMomentum,
        playsMomentum,
        momentum,
        coveredCreators,
        trackedCreators: tracked.length,
        coverage,
        coverageGap,
        opportunity,
        lead: {
          title: leadPost.title,
          hashtag: leadPost.hashtag,
          plays: leadPost.plays,
          publishedAt: leadPost.publishedAt,
          ...(leadPost.ownerHandle ? { ownerHandle: leadPost.ownerHandle } : {}),
          ...(leadPost.url ? { url: leadPost.url } : {}),
        },
        reason: `${signed(deltaPosts)} Posts und ${signed(deltaPlays)} Plays gegenüber der Vorwoche. ${coverageText}`,
      };
    })
    .sort((a, b) => b.opportunity - a.opportunity || b.momentum - a.momentum || a.label.localeCompare(b.label));

  return {
    generatedAt: new Date(now).toISOString(),
    windowDays,
    sourceHashtags: input.sourceHashtags ?? [...new Set(input.posts.map((post) => `#${post.hashtag}`))].sort(),
    trackedCreators: tracked.length,
    topics,
  };
}
