"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { RankedSignal } from "@/lib/contracts";

/** A filter-keyed feed reveals the already loaded corpus one batch at a time. */
export function DiscoverFeed({ signals, batchSize, controls, children }: {
  signals: RankedSignal[];
  batchSize: number;
  controls: ReactNode;
  children: (shown: RankedSignal[]) => ReactNode;
}) {
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const [loading, startTransition] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const manualFocusIndex = useRef<number | null>(null);
  const shown = signals.slice(0, visibleCount);
  const hasMore = shown.length < signals.length;
  const loadMore = useCallback(() => {
    startTransition(() => setVisibleCount((count) => Math.min(count + batchSize, signals.length)));
  }, [batchSize, signals.length]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore || loading || typeof IntersectionObserver === "undefined") return;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!active || !entries.some((entry) => entry.isIntersecting)) return;
      active = false;
      observer.disconnect();
      loadMore();
    }, { rootMargin: "400px 0px" });
    observer.observe(target);
    return () => { active = false; observer.disconnect(); };
  }, [hasMore, loading, loadMore, visibleCount]);

  useEffect(() => {
    const index = manualFocusIndex.current;
    if (loading || index === null || visibleCount <= index) return;
    manualFocusIndex.current = null;
    const card = content.current?.querySelectorAll<HTMLElement>(".signal-card")[index];
    card?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
  }, [visibleCount, loading]);

  return (
    <>
      <div className="results-row">
        <span role="status">Showing {shown.length ? 1 : 0}–{shown.length} of {signals.length} videos</span>
        {controls}
      </div>
      <div ref={content} aria-busy={loading}>{children(shown)}</div>
      {signals.length > 0 && (
        <div className="feed-pagination" ref={sentinel}>
          {hasMore ? (
            <>
              <button className="ghost-button" type="button" onClick={() => {
                manualFocusIndex.current = shown.length;
                loadMore();
              }} disabled={loading}>
                {loading ? "Loading videos…" : `Load ${Math.min(batchSize, signals.length - shown.length)} more videos`}
              </button>
              <span>More videos appear as you scroll.</span>
            </>
          ) : <span>All {signals.length} matching videos shown.</span>}
        </div>
      )}
    </>
  );
}
