import {
  INSTAGRAM_HASHTAG_COST_LIMIT_USD,
  INSTAGRAM_HASHTAG_MAX_TAGS,
  INSTAGRAM_HASHTAG_RESULTS_PER_TAG,
  INSTAGRAM_HASHTAG_WINDOW_DAYS,
  INSTAGRAM_HASHTAGS,
} from "../../config.ts";
import type { HashtagCollection, HashtagConnector, HashtagPost, RunUsage } from "../../contracts";
import { sumUsage } from "../../run-cost.ts";
import { isGermanCaption, classifyTopic } from "../../trend-radar.ts";
import { runActor, type ActorResult } from "./apify-client.ts";

type ApifyHashtagPost = {
  id?: unknown;
  shortCode?: unknown;
  shortcode?: unknown;
  code?: unknown;
  url?: unknown;
  permalink?: unknown;
  caption?: unknown;
  hashtags?: unknown;
  timestamp?: unknown;
  takenAt?: unknown;
  createdAt?: unknown;
  videoPlayCount?: unknown;
  videoViewCount?: unknown;
  viewCount?: unknown;
  views?: unknown;
  likesCount?: unknown;
  commentsCount?: unknown;
  ownerUsername?: unknown;
  username?: unknown;
  owner?: unknown;
  error?: unknown;
};

export type HashtagActorRunner = <T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  options?: { maxTotalChargeUsd?: number },
) => Promise<ActorResult<T>>;

export type HashtagCollectResult = HashtagCollection;

const APIFY_HASHTAG_ACTOR = "apify~instagram-scraper";
const MAX_CAPTION_LENGTH = 2_000;
const MAX_HASHTAGS_PER_POST = 30;

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Canonical hashtag value sent to Apify and stored without the leading #. */
export function normalizeHashtag(value: string) {
  return value
    .trim()
    .replace(/^#/, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9äöüß._-]/gi, "");
}

/** Environment override stays server-side; the checked-in list keeps demo mode deterministic. */
export function configuredInstagramHashtags(value = process.env.INSTAGRAM_HASHTAGS) {
  const source = value?.split(",") ?? [...INSTAGRAM_HASHTAGS];
  return [...new Set(source.map(normalizeHashtag).filter(Boolean))].slice(0, INSTAGRAM_HASHTAG_MAX_TAGS);
}

function asHashtags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => (typeof item === "string" ? normalizeHashtag(item) : "")).filter(Boolean))]
    .slice(0, MAX_HASHTAGS_PER_POST);
}

function shortcode(post: ApifyHashtagPost) {
  const direct = stringValue(post.shortCode) || stringValue(post.shortcode) || stringValue(post.code);
  if (direct) return direct;
  const url = stringValue(post.url) || stringValue(post.permalink);
  return url?.match(/\/p\/([^/?#]+)/i)?.[1];
}

function ownerHandle(post: ApifyHashtagPost) {
  const owner = post.owner && typeof post.owner === "object" ? post.owner as Record<string, unknown> : undefined;
  return stringValue(post.ownerUsername) || stringValue(post.username) || stringValue(owner?.username);
}

function captionOf(post: ApifyHashtagPost) {
  const caption = stringValue(post.caption);
  return caption ? caption.slice(0, MAX_CAPTION_LENGTH) : undefined;
}

function publishedAtOf(post: ApifyHashtagPost) {
  const value = stringValue(post.timestamp) || stringValue(post.takenAt) || stringValue(post.createdAt);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function firstLine(caption: string | undefined, code: string) {
  const line = caption?.split("\n").map((part) => part.trim()).find(Boolean) || `Instagram post ${code}`;
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

function mapPost(raw: ApifyHashtagPost, requested: string[], collectedAt: string): HashtagPost | null {
  if (stringValue(raw.error)) return null;
  const code = shortcode(raw);
  const publishedAt = publishedAtOf(raw);
  const caption = captionOf(raw);
  if (!code || !publishedAt || !caption || !isGermanCaption(caption)) return null;

  const hashtags = asHashtags(raw.hashtags);
  const hashtag = requested.find((tag) => hashtags.includes(tag)) || hashtags[0] || requested[0];
  if (!hashtag) return null;
  const text = [caption, ...hashtags].join(" ");
  const plays = numberValue(raw.videoPlayCount) ?? numberValue(raw.videoViewCount) ?? numberValue(raw.viewCount) ?? numberValue(raw.views) ?? 0;
  const likes = numberValue(raw.likesCount) ?? 0;
  const comments = numberValue(raw.commentsCount) ?? 0;
  const url = stringValue(raw.url) || stringValue(raw.permalink) || `https://www.instagram.com/p/${code}/`;
  const handle = ownerHandle(raw);

  return {
    id: `ig-hashtag-${code}`,
    externalId: code,
    hashtag,
    hashtags: [...new Set([hashtag, ...hashtags])].slice(0, MAX_HASHTAGS_PER_POST),
    ...(handle ? { ownerHandle: handle } : {}),
    title: firstLine(caption, code),
    caption,
    publishedAt,
    plays,
    likes,
    comments,
    url,
    topic: classifyTopic(text),
    language: "de",
    collectedAt,
  };
}

/**
 * One bounded Apify hashtag search. The raw actor response is mapped here and
 * never crosses into storage or UI code.
 */
export async function collectHashtagPosts(
  hashtags = configuredInstagramHashtags(),
  run: HashtagActorRunner = runActor,
  now = new Date(),
): Promise<HashtagCollectResult> {
  const requested = [...new Set(hashtags.map(normalizeHashtag).filter(Boolean))].slice(0, INSTAGRAM_HASHTAG_MAX_TAGS);
  if (requested.length === 0) return { posts: [], usage: { unreported: 0 } };

  const result = await run(APIFY_HASHTAG_ACTOR, {
    hashtags: requested,
    resultsType: "posts",
    resultsLimit: Math.min(INSTAGRAM_HASHTAG_MAX_TAGS * INSTAGRAM_HASHTAG_RESULTS_PER_TAG, requested.length * INSTAGRAM_HASHTAG_RESULTS_PER_TAG),
    onlyPostsNewerThan: `${INSTAGRAM_HASHTAG_WINDOW_DAYS} days`,
    addParentData: false,
  }, { maxTotalChargeUsd: INSTAGRAM_HASHTAG_COST_LIMIT_USD });
  const collectedAt = now.toISOString();
  const posts: HashtagPost[] = [];
  const seen = new Set<string>();
  for (const raw of result.items) {
    if (!raw || typeof raw !== "object") continue;
    const post = mapPost(raw as ApifyHashtagPost, requested, collectedAt);
    if (!post || seen.has(post.externalId)) continue;
    seen.add(post.externalId);
    posts.push(post);
  }
  return { posts, usage: sumUsage([result.usage]) };
}

/** Adapter boundary used by the daily Trend-Radar sweep. */
export const apifyInstagramHashtagConnector: HashtagConnector = {
  id: "apify-instagram-hashtags",
  collect: collectHashtagPosts,
};

export { APIFY_HASHTAG_ACTOR, INSTAGRAM_HASHTAG_COST_LIMIT_USD };
