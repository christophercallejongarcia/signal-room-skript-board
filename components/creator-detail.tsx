"use client";

import { ArrowLeft, ArrowSquareOut, ArrowRight, ArrowUp, Globe, Pulse, UserCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CoverImage, formatNumber, formatOutlier, networkName, timeAgo } from "@/components/display";
import { ReelDetailPanel, TranscriptStatusBadge } from "@/components/reel-detail";
import type { Creator, SignalRecord } from "@/lib/contracts";
import {
  CREATOR_SORTS,
  FROM_PARAM,
  creatorSignals,
  creatorStats,
  parseThreshold,
  signalReach,
  sortCreatorSignals,
  tabPath,
  type CreatorSort,
  type CreatorSortState,
} from "@/lib/creator-detail";
import { demoCreators, demoSignals } from "@/lib/demo-data";
import { DEFAULT_OUTLIER_THRESHOLD, isOutlier, isOwned, storeOrDemo, type OutlierThreshold } from "@/lib/discover-filter";
import { rankCorpus } from "@/lib/rank-corpus";

type Phase = "loading" | "ready" | "error";

/** The tabs a creator can be opened from, with the label their back link carries. */
const ORIGINS: Record<string, string> = { channels: "tracked channels", discover: "discover" };
const DEFAULT_ORIGIN = "channels";

/** How each sortable column reads in the header, and which side it sits on. */
const COLUMNS: Record<CreatorSort, { label: string; right: boolean; hideSm: boolean }> = {
  published: { label: "Published", right: false, hideSm: true },
  plays: { label: "Plays", right: true, hideSm: false },
  outlier: { label: "Outlier", right: true, hideSm: false },
};

/** Dates and numbers both open on their strongest value. */
const DEFAULT_SORT: CreatorSortState = { sort: "published", direction: "desc" };

export function CreatorDetail({ creatorId }: { creatorId: string }) {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [live, setLive] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [order, setOrder] = useState<CreatorSortState>(DEFAULT_SORT);
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
  const [threshold, setThreshold] = useState<OutlierThreshold>(DEFAULT_OUTLIER_THRESHOLD);
  const [selectedReel, setSelectedReel] = useState<ReturnType<typeof rankCorpus>[number] | null>(null);

  // The link that opened this page carries where it came from and what the desk was
  // liming at, so Back returns to that list and the outlier column agrees with it.
  useEffect(() => {
    const search = window.location.search;
    const from = new URLSearchParams(search).get(FROM_PARAM);
    if (from && from in ORIGINS) setOrigin(from);
    setThreshold(parseThreshold(search, DEFAULT_OUTLIER_THRESHOLD));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/signals", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { creators: Creator[]; signals: SignalRecord[] };
        if (cancelled) return;
        // The same rule the desk follows: one real creator hides every demo fixture.
        const store = storeOrDemo(data, { creators: demoCreators, signals: demoSignals });
        setCreators(store.creators);
        setSignals(store.signals);
        setLive(store === data);
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const creator = creators.find((item) => item.id === creatorId);
  const ranked = useMemo(() => rankCorpus(signals, creators, live), [creators, signals, live]);
  const mine = useMemo(() => creatorSignals(ranked, creatorId), [ranked, creatorId]);
  const stats = creatorStats(mine);
  const rows = sortCreatorSignals(mine, order);
  const nowMs = Date.now();
  const back = { href: tabPath(origin), label: `Back to ${ORIGINS[origin]}` };

  /** Clicking the active column flips it; a new column opens at its default direction. */
  function sortBy(sort: CreatorSort) {
    setOrder((current) =>
      current.sort === sort
        ? { sort, direction: current.direction === "desc" ? "asc" : "desc" }
        : { sort, direction: DEFAULT_SORT.direction },
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar detail-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark"><Pulse size={26} weight="bold" /></span>
          <span>
            <strong>Signal Room</strong>
            <small>Intelligence desk</small>
          </span>
        </Link>
        <Link className="back-link" href={back.href}>
          <ArrowLeft size={14} weight="bold" /> {back.label}
        </Link>
      </header>

      <main>
        {phase === "loading" && <div className="empty-state">Loading the corpus…</div>}
        {phase === "error" && <div className="empty-state">The corpus is unreachable. Reload to try again.</div>}
        {phase === "ready" && !creator && (
          <div className="empty-state">
            No tracked creator with the id {creatorId}. <Link href={back.href}>{back.label}</Link>
          </div>
        )}
        {phase === "ready" && creator && (
          <div className="view-stack">
            <section className="hero creator-hero">
              <div className="creator-identity">
                <span className="creator-avatar large" style={{ background: creator.accent }}>
                  {creator.avatarUrl ? <img src={creator.avatarUrl} alt="" referrerPolicy="no-referrer" /> : creator.name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <p className="hero-kicker">
                    {networkName(creator.network)} / {creator.audience ? `${formatNumber(creator.audience)} followers` : "audience pending"}
                  </p>
                  <h1>{creator.name}</h1>
                  <p className="hero-sub">
                    {creator.handle} · every retained upload of this creator, read with the same follower-relative outlier as the feed.
                    {creator.lastCheckedAt ? ` Last checked ${timeAgo(creator.lastCheckedAt, nowMs)}.` : ""}
                  </p>
                  <p className="creator-marks">
                    {isOwned(creator) && <span className="niche-chip owned"><UserCircle size={12} /> Own account</span>}
                    {creator.foreign && <span className="niche-chip"><Globe size={12} /> Foreign niche</span>}
                    {creator.url && (
                      <a className="signal-link" href={creator.url} target="_blank" rel="noreferrer">
                        Open profile <ArrowSquareOut size={11} />
                      </a>
                    )}
                  </p>
                </div>
              </div>
              <div className="stat-blocks">
                <div><strong>{formatNumber(stats.views)}</strong><span>views in corpus</span></div>
                <div><strong>{formatOutlier(stats.averageOutlier)}</strong><span>average outlier</span></div>
                <div className="lime"><strong>{formatOutlier(stats.strongestOutlier)}</strong><span>strongest outlier</span></div>
                <div><strong>{stats.retained}</strong><span>videos retained</span></div>
              </div>
            </section>

            <div className="section-head">
              <div><p className="kicker">Retained corpus</p><h2>Every retained upload</h2></div>
              <p className="note">
                Sort by date, plays or outlier. An outlier at or above {threshold}x the follower count reads in lime.
              </p>
            </div>

            <table className="desk-table sortable">
              <thead>
                <tr>
                  <th>Video</th>
                  {CREATOR_SORTS.map((sort) => {
                    const column = COLUMNS[sort];
                    const active = order.sort === sort;
                    return (
                      <th
                        key={sort}
                        className={[column.right ? "right" : "", column.hideSm ? "hide-sm" : ""].filter(Boolean).join(" ") || undefined}
                        aria-sort={active ? (order.direction === "asc" ? "ascending" : "descending") : "none"}
                      >
                        <button type="button" className={active ? "sort-head active" : "sort-head"} onClick={() => sortBy(sort)}>
                          {column.label}
                          <ArrowUp size={10} weight="bold" className={active && order.direction === "desc" ? "flip" : undefined} />
                        </button>
                      </th>
                    );
                  })}
                  <th className="right">Link</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((signal, index) => (
                  <tr key={signal.id}>
                    <td>
                      <div className="thumb-cell">
                        <CoverImage signal={signal} index={index} className={signal.format === "reel" ? "mini portrait" : "mini"} lazy />
                        <div>
                          <strong>{signal.title}</strong>
                          <span className="thumb-subline"><small>{signal.format ?? "video"} · {signal.topic}</small><TranscriptStatusBadge signal={signal} compact /></span>
                        </div>
                      </div>
                    </td>
                    <td className="hide-sm muted">
                      {new Date(signal.publishedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="right num">{formatNumber(signalReach(signal))}</td>
                    <td className={isOutlier(signal, threshold) ? "right lime" : "right num"}>{(signal.outlier ?? 0).toFixed(2)}x</td>
                    <td className="right">
                      <button className="icon-button" type="button" onClick={() => setSelectedReel(signal)} aria-label={`Open Reel view for ${signal.title}`} title="Open Reel view">
                        <ArrowRight size={14} />
                      </button>
                      {signal.url ? (
                        <a className="icon-button" href={signal.url} target="_blank" rel="noreferrer" aria-label={`Open ${signal.title} on ${networkName(creator.network)}`}>
                          <ArrowSquareOut size={14} />
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={CREATOR_SORTS.length + 2}><div className="empty-state">No uploads retained for this creator yet.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
      {selectedReel && (
        <ReelDetailPanel signal={selectedReel} creator={creator!} onClose={() => setSelectedReel(null)} />
      )}
    </div>
  );
}
