import { NextResponse } from "next/server";
import { configuredInstagramHashtags } from "@/lib/adapters/sources/apify-instagram-hashtags";
import { getStorage } from "@/lib/adapters/storage";
import { runHashtagSweep } from "@/lib/hashtag-sweep";
import { buildTrendRadar } from "@/lib/trend-radar";

export const runtime = "nodejs";

const HASHTAG_POST_LIMIT = 5_000;

async function readRadar() {
  const storage = getStorage();
  const [posts, signals, creators] = await Promise.all([
    storage.listHashtagPosts(HASHTAG_POST_LIMIT),
    storage.listSignals(),
    storage.listCreators(),
  ]);
  return buildTrendRadar({
    posts,
    signals,
    creators,
    sourceHashtags: configuredInstagramHashtags().map((tag) => `#${tag}`),
  });
}

/** The current deterministic Radar over the stored Instagram hashtag corpus. */
export async function GET() {
  try {
    return NextResponse.json({ radar: await readRadar() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Trend Radar unavailable." }, { status: 500 });
  }
}

/** Human-triggered collection pass. The daily Convex cron uses the same function. */
export async function POST() {
  try {
    const run = await runHashtagSweep();
    return NextResponse.json({ run, radar: await readRadar() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The hashtag sweep failed." }, { status: 502 });
  }
}

