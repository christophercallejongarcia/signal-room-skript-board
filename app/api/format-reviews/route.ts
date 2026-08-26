import { NextResponse } from "next/server";
import { getStorage } from "@/lib/adapters/storage";
import { reviewCorpus } from "@/lib/format-review";

export const runtime = "nodejs";

/** The latest monthly review, null before the first pass has run. */
export async function GET() {
  const [review = null] = await getStorage().listFormatReviews(1);
  return NextResponse.json({ review });
}

/**
 * Runs the review now, through the same computation as the cron. The Convex cron
 * owns the monthly schedule (convex/crons.ts); this route is the manual pass, and
 * the only path the file store has (ADR-0005).
 */
export async function POST() {
  const storage = getStorage();
  const [creators, signals, reviews] = await Promise.all([
    storage.listCreators(),
    storage.listSignals(),
    // Two, so a rerun on the same run date diffs against the review before it.
    storage.listFormatReviews(2),
  ]);
  const review = reviewCorpus({ creators, signals, reviews }, Date.now());
  await storage.saveFormatReview(review);
  return NextResponse.json({ review });
}
