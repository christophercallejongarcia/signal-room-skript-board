import type { HashtagPost } from "./contracts";

/** Idempotent merge for the hashtag corpus, keyed by the Instagram shortcode. */
export function mergeHashtagPosts(
  existing: HashtagPost[],
  incoming: HashtagPost[],
): { posts: HashtagPost[]; inserted: number; updated: number } {
  const byId = new Map(existing.map((post) => [post.externalId, post]));
  const known = new Set(byId.keys());
  const touched = new Set<string>();
  let inserted = 0;
  let updated = 0;

  for (const post of incoming) {
    const current = byId.get(post.externalId);
    const hashtags = [...new Set([...(current?.hashtags ?? []), ...post.hashtags])].slice(0, 30);
    byId.set(post.externalId, { ...current, ...post, hashtags });
    if (touched.has(post.externalId)) continue;
    touched.add(post.externalId);
    if (known.has(post.externalId)) updated += 1;
    else inserted += 1;
  }

  return { posts: [...byId.values()], inserted, updated };
}

