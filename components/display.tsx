"use client";

import { useState } from "react";
import type { Network, SignalRecord } from "@/lib/contracts";

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatNumber(value: number) {
  return compactNumber.format(value);
}

export function timeAgo(iso: string, now: number) {
  const days = Math.max(0, Math.round((now - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

/** The network under its own name. One spelling, shared by every view. */
export function networkName(network: Network) {
  return network === "instagram" ? "Instagram" : network === "youtube" ? "YouTube" : "TikTok";
}

/** A lane without a single retained upload has no outlier to show. */
export function formatOutlier(outlier: number | null) {
  return outlier === null ? "—" : `${outlier.toFixed(2)}x`;
}

/** Only the four cover fields, so a Briefing item renders through the same component as a card. */
type Coverable = Pick<SignalRecord, "coverUrl" | "thumbnailUrl" | "thumbnailSeed" | "topic">;

/**
 * Renders the cached cover. Until the cache has the file, the CDN link is tried
 * once (fresh records still resolve); an expired link or a missing file falls
 * back to the generative artwork instead of a broken image.
 */
export function CoverImage({ signal, index, className, lazy }: { signal: Coverable; index: number; className?: string; lazy?: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = signal.coverUrl ?? signal.thumbnailUrl;
  if (src && !broken) {
    return <img className={className} src={src} alt="" loading={lazy ? "lazy" : undefined} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  const art = <SignalArtwork seed={signal.thumbnailSeed} topic={signal.topic} index={index} />;
  return className ? <div className={className}>{art}</div> : art;
}

export function SignalArtwork({ seed, topic, index = 0 }: { seed: string; topic: string; index?: number }) {
  const motif = seed.split("-").slice(0, 2).join(" ");
  return (
    <div className={`signal-art art-${index % 4}`} role="img" aria-label={`Sample artwork for ${topic}`}>
      <span className="art-grid" />
      <span className="art-orbit" />
      <span className="art-copy">{motif}</span>
      <span className="art-topic">{topic}</span>
    </div>
  );
}
