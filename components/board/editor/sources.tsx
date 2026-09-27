"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BoardSession } from "@/lib/board/board-session";
import { BoardClientError, boardApi } from "@/lib/board/client";
import { newOpaqueId } from "@/lib/board/ids";
import type { SourceView } from "@/lib/board/youtube-ingest";

/**
 * YouTube sources of the open board (PLAN.md points 68 to 71): polls the status
 * while a transcript is on its way, starts the ingest for new videos, and fills
 * an empty node title from the video title.
 */
export type SourcesValue = {
  sources: Map<string, SourceView>;
  errors: Map<string, string>;
  apify: { enabled: boolean; maxUsd: number };
  ingest(videoId: string, retry?: boolean): Promise<void>;
  buyApify(videoId: string): Promise<void>;
};

const SourcesContext = createContext<SourcesValue | null>(null);

export function useSources(): SourcesValue {
  const value = useContext(SourcesContext);
  if (!value) throw new Error("useSources außerhalb des Board-Editors.");
  return value;
}

const BUSY = new Set(["pending", "apify-pending"]);

export function SourcesProvider({ session, videoIds, writable, children }: { session: BoardSession; videoIds: string[]; writable: boolean; children: React.ReactNode }) {
  const [sources, setSources] = useState<Map<string, SourceView>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [apify, setApify] = useState({ enabled: false, maxUsd: 0.05 });
  const started = useRef(new Set<string>());
  const key = [...new Set(videoIds)].sort().join(",");

  const refresh = useCallback(async () => {
    if (!key) return new Map<string, SourceView>();
    try {
      const result = await boardApi<{ sources: SourceView[] }>(`/youtube?ids=${encodeURIComponent(key)}`);
      const next = new Map(result.sources.map((source) => [source.videoId, source]));
      setSources(next);
      return next;
    } catch {
      return null;
    }
  }, [key]);

  const ingest = useCallback(
    async (videoId: string, retry = false) => {
      setErrors((current) => {
        const next = new Map(current);
        next.delete(videoId);
        return next;
      });
      try {
        const result = await boardApi<{ status: string; message?: string; source?: SourceView }>("/youtube", { method: "POST", body: { videoId, retry } });
        if (result.source) setSources((current) => new Map(current).set(videoId, result.source!));
      } catch (error) {
        const message = error instanceof BoardClientError ? error.message : "YouTube-Abruf fehlgeschlagen.";
        setErrors((current) => new Map(current).set(videoId, message));
      }
      await refresh();
    },
    [refresh],
  );

  const buyApify = useCallback(
    async (videoId: string) => {
      try {
        await boardApi("/youtube/apify", { method: "POST", body: { videoId, requestId: newOpaqueId("apify") } });
      } catch (error) {
        setErrors((current) => new Map(current).set(videoId, error instanceof BoardClientError ? error.message : "Apify-Abruf fehlgeschlagen."));
      }
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void boardApi<{ enabled: boolean; maxUsd: number }>("/youtube/apify").then(setApify, () => {});
  }, []);

  // First load and new videos: start the ingest once per video and page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const current = await refresh();
      if (cancelled || !current || !writable) return;
      for (const videoId of key.split(",").filter(Boolean)) {
        if (current.has(videoId) || started.current.has(videoId)) continue;
        started.current.add(videoId);
        void ingest(videoId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, refresh, ingest, writable]);

  // Poll every 2 s while something is on its way, else every 60 s.
  const busy = [...sources.values()].some((source) => BUSY.has(source.transcriptStatus));
  useEffect(() => {
    if (!key) return;
    const timer = setInterval(() => void refresh(), busy ? 2_000 : 60_000);
    return () => clearInterval(timer);
  }, [busy, key, refresh]);

  // The video title goes into an empty node title (Poppy leaves it empty; point 71 stores it).
  useEffect(() => {
    if (!writable) return;
    for (const node of session.model.nodes.values()) {
      if (node.type !== "youtubeNode" || !node.data.videoId || session.titleFor(node.id)) continue;
      const title = sources.get(node.data.videoId)?.title;
      if (title) void session.setTitle(node.id, title.slice(0, 200));
    }
  }, [sources, session, writable]);

  const value = useMemo(() => ({ sources, errors, apify, ingest, buyApify }), [sources, errors, apify, ingest, buyApify]);
  return <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>;
}
