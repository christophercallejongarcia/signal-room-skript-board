import type { Creator, RunUsage, SignalRecord, SourceConnector } from "../../contracts";
import { MAX_RESULTS_PER_CREATOR } from "../../config.ts";
import { refreshWindowSince } from "../../refresh-window.ts";
import { sumUsage } from "../../run-cost.ts";
import { runActor } from "./apify-client.ts";

type ApifyProfile = {
  username?: string;
  fullName?: string;
  followersCount?: number;
  profilePicUrl?: string;
  profilePicUrlHD?: string;
  url?: string;
  error?: string;
};

type ApifyPost = {
  id?: string;
  shortCode?: string;
  type?: string;
  productType?: string;
  caption?: string;
  hashtags?: string[];
  url?: string;
  displayUrl?: string;
  timestamp?: string;
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  videoDuration?: number;
  ownerUsername?: string;
  error?: string;
};

export type ResolvedProfile = {
  handle: string;
  name: string;
  followers: number;
  avatarUrl?: string;
  url: string;
};

export function normalizeHandle(input: string) {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "")
    .toLowerCase();
}

export async function resolveProfile(handleInput: string): Promise<ResolvedProfile> {
  const handle = normalizeHandle(handleInput);
  const { items } = await runActor<ApifyProfile>("apify~instagram-profile-scraper", { usernames: [handle] });
  const profile = items.find((item) => !item.error);
  if (!profile) throw new Error(`Instagram profile @${handle} not found (${items[0]?.error ?? "no data"})`);
  return {
    handle,
    name: profile.fullName?.trim() || handle,
    followers: profile.followersCount ?? 0,
    avatarUrl: profile.profilePicUrlHD || profile.profilePicUrl,
    url: profile.url || `https://www.instagram.com/${handle}/`,
  };
}

function firstLine(caption: string | undefined) {
  const line = (caption ?? "").split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

function mapPost(post: ApifyPost, creator: Creator): SignalRecord | null {
  const shortCode = post.shortCode;
  if (!shortCode || !post.timestamp) return null;
  const plays = post.videoPlayCount ?? undefined;
  const views = post.videoViewCount ?? plays ?? 0;
  const isVideo = post.type === "Video" || post.productType === "clips";
  return {
    id: `ig-${shortCode}`,
    externalId: shortCode,
    creatorId: creator.id,
    title: firstLine(post.caption) || (isVideo ? "Untitled reel" : "Untitled post"),
    publishedAt: new Date(post.timestamp).toISOString(),
    views,
    plays,
    likes: post.likesCount ?? 0,
    comments: post.commentsCount ?? 0,
    durationSeconds: Math.round(post.videoDuration ?? 0),
    thumbnailSeed: shortCode,
    thumbnailUrl: post.displayUrl,
    url: post.url || `https://www.instagram.com/p/${shortCode}/`,
    caption: post.caption,
    format: isVideo ? "reel" : "post",
    topic: post.hashtags?.[0] ?? "general",
  };
}

export type ActorRunner = typeof runActor;

/** Signals of one creator plus what the two actor streams cost. */
export type CollectResult = { records: SignalRecord[]; usage: RunUsage };

export async function collectForCreator(creator: Creator, run: ActorRunner = runActor): Promise<CollectResult> {
  const handle = normalizeHandle(creator.handle);
  // "posts" misses reels on many accounts (only the grid/carousel tab); "reels" misses image posts.
  // Fetch both and merge by shortCode so the corpus is complete.
  // A failing stream throws (naming every failed stream): the caller must not
  // advance lastCheckedAt on a partial result.
  const since = refreshWindowSince(creator);
  const streams = ["reels", "posts"] as const;
  const settled = await Promise.allSettled(
    streams.map((resultsType) =>
      run<ApifyPost>("apify~instagram-scraper", {
        directUrls: [`https://www.instagram.com/${handle}/`],
        resultsType,
        resultsLimit: MAX_RESULTS_PER_CREATOR,
        onlyPostsNewerThan: since,
        addParentData: false,
      }),
    ),
  );
  const failures = settled.flatMap((result, i) =>
    result.status === "rejected" ? [`${streams[i]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : [],
  );
  if (failures.length) throw new Error(failures.join("; "));
  // Every result is fulfilled here: a rejection threw above.
  const results = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const batches = results.map((result) => result.items);
  const seen = new Set<string>();
  const records: SignalRecord[] = [];
  for (const item of batches.flat()) {
    if (item.error) continue;
    const record = mapPost(item, creator);
    if (!record || (record.externalId && seen.has(record.externalId))) continue;
    if (record.externalId) seen.add(record.externalId);
    records.push(record);
  }
  return { records, usage: sumUsage(results.map((result) => result.usage)) };
}

export const apifyInstagramConnector: SourceConnector = {
  id: "apify-instagram",
  async collect(creators) {
    const results: SignalRecord[] = [];
    for (const creator of creators.filter((c) => c.network === "instagram")) {
      results.push(...(await collectForCreator(creator)).records);
    }
    return results;
  },
};
