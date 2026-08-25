"use client";

import {
  ArrowRight,
  ArrowsClockwise,
  Binoculars,
  ChartLineUp,
  CheckCircle,
  Clock,
  House,
  ImageSquare,
  Lightbulb,
  NewspaperClipping,
  Plus,
  Shapes,
  Sparkle,
  TextAa,
  TrendUp,
  UserCircle,
  WarningCircle,
  X,
  ArrowSquareOut,
  MagnifyingGlass,
  Pulse,
  Trash,
  InstagramLogo,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { demoCreators, demoIdeas, demoSignals } from "@/lib/demo-data";
import { DEMO_SCORING_NOTE, demoScorer } from "@/lib/demo-score";
import { outlierScorer } from "@/lib/adapters/scoring/outlier";
import {
  DEFAULT_OUTLIER_THRESHOLD,
  OUTLIER_THRESHOLDS,
  countOutliers,
  filterDiscover,
  isOutlier,
  storeOrDemo,
  type DiscoverView as DiscoverViewMode,
  type OutlierThreshold,
  type PublishedWindow,
} from "@/lib/discover-filter";
import {
  OUTLIER_THRESHOLD,
  STRATEGY_AUDIENCE,
  STRATEGY_EVIDENCE_LIMIT,
  STRATEGY_EVIDENCE_WINDOW_DAYS,
  STRATEGY_GOAL,
} from "@/lib/config";
import { selectEvidence } from "@/lib/strategy-evidence";
import type { RefreshResult, Run, SignalRecord } from "@/lib/contracts";
import type { Creator, Network, StrategyEvidenceItem, StrategyResponse } from "@/lib/contracts";

/** The web app only ever talks to the local bridge, never to a model endpoint (ADR-0004). */
const bridgeUrl = process.env.NEXT_PUBLIC_STRATEGY_BRIDGE_URL || "http://127.0.0.1:3211";

/** Reachability plus Codex login, as reported by the bridge health route. */
type BridgeHealth = "checking" | "online" | "offline" | "logged-out";

/** An Idea captured from a strategy run, held for this session. Persistence lands with ticket 08. */
type CapturedIdea = StrategyResponse & { id: string; capturedAt: string; evidenceCount: number };

/** The strategy panel's own state. These four always travel together. */
type StrategyState = {
  result: StrategyResponse | null;
  phase: "idle" | "loading" | "error";
  error: string;
  evidence: StrategyEvidenceItem[];
};

const navItems = [
  { id: "discover", label: "Discover", icon: House },
  { id: "briefing", label: "Briefing", icon: NewspaperClipping },
  { id: "radar", label: "Trend Radar", icon: TrendUp },
  { id: "formats", label: "Format Signals", icon: Shapes },
  { id: "channels", label: "Tracked Channels", icon: Binoculars },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "thumbnails", label: "Thumbnail Lab", icon: ImageSquare },
  { id: "titles", label: "Titles", icon: TextAa },
  { id: "profile", label: "Profile", icon: UserCircle },
] as const;

type TabId = (typeof navItems)[number]["id"];

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function formatNumber(value: number) {
  return compactNumber.format(value);
}

function NetworkLabel({ network }: { network: Network }) {
  return <span className="network-label">{network === "instagram" ? "Instagram" : network === "youtube" ? "YouTube" : "TikTok"}</span>;
}

type Ranked = ReturnType<typeof demoScorer.rank>[number];

const HOURS_48 = 48 * 60 * 60 * 1000;

function formatThreshold(value: number) {
  return `${value}x`;
}

function isNew(publishedAt: string, now: number) {
  return now - new Date(publishedAt).getTime() < HOURS_48;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function formatStarted(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string, now: number) {
  const days = Math.max(0, Math.round((now - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function SignalMedia({ signal, index, threshold }: { signal: Ranked; index: number; threshold: number }) {
  const now = Date.now();
  const reel = signal.format === "reel";
  const outlier = signal.outlier ?? 0;
  return (
    <div className={reel ? "signal-media reel" : "signal-media"}>
      <CoverImage signal={signal} index={index} lazy />
      <div className="badge-row">
        <span>{isOutlier(signal, threshold) && <span className="badge outlier">{outlier.toFixed(1)}x</span>}</span>
        {isNew(signal.publishedAt, now) && <span className="badge lime">NEW</span>}
      </div>
      {(reel || signal.format === "short") && (
        <div className="badge-bottom"><span className="badge format">Short form</span></div>
      )}
    </div>
  );
}

/**
 * Renders the cached cover. Until the cache has the file, the CDN link is tried
 * once (fresh records still resolve); an expired link or a missing file falls
 * back to the generative artwork instead of a broken image.
 */
function CoverImage({ signal, index, className, lazy }: { signal: SignalRecord; index: number; className?: string; lazy?: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = signal.coverUrl ?? signal.thumbnailUrl;
  if (src && !broken) {
    return <img className={className} src={src} alt="" loading={lazy ? "lazy" : undefined} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  const art = <SignalArtwork seed={signal.thumbnailSeed} topic={signal.topic} index={index} />;
  return className ? <div className={className}>{art}</div> : art;
}

function SignalArtwork({ seed, topic, index = 0 }: { seed: string; topic: string; index?: number }) {
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

export function SignalRoom() {
  const [activeTab, setActiveTab] = useState<TabId>("discover");
  const [network, setNetwork] = useState<Network>("instagram");
  const [creators, setCreators] = useState<Creator[]>(demoCreators);
  const [signals, setSignals] = useState<SignalRecord[]>(demoSignals);
  const [live, setLive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("Demo snapshot");
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsState, setRunsState] = useState<"loading" | "ready" | "error">("loading");
  const [addState, setAddState] = useState<"idle" | "loading" | "error">("idle");
  const [threshold, setThreshold] = useState<OutlierThreshold>(DEFAULT_OUTLIER_THRESHOLD);

  async function loadStore() {
    const response = await fetch("/api/signals");
    if (!response.ok) return;
    const data = (await response.json()) as { creators: Creator[]; signals: SignalRecord[] };
    // One real creator hides every demo fixture. Demo only exists for an empty store.
    const store = storeOrDemo(data, { creators: demoCreators, signals: demoSignals });
    const isLive = store === data;
    setCreators(store.creators);
    setSignals(store.signals);
    setLive(isLive);
    setLastRefresh(isLive ? "Stored snapshot" : "Demo snapshot");
  }

  async function loadRuns() {
    try {
      const response = await fetch("/api/runs");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { runs: Run[] };
      setRuns(data.runs);
      setRunsState("ready");
    } catch {
      setRunsState("error");
    }
  }

  async function checkBridge() {
    setBridge("checking");
    try {
      const response = await fetch(`${bridgeUrl}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = (await response.json()) as { codex?: string };
      setBridge(health.codex === "logged-out" ? "logged-out" : "online");
    } catch {
      setBridge("offline");
    }
  }

  useEffect(() => {
    loadStore().catch(() => {});
    loadRuns();
    checkBridge();
  }, []);
  const [showAddCreator, setShowAddCreator] = useState(false);
  const [strategy, setStrategy] = useState<StrategyResponse | null>(null);
  const [strategyState, setStrategyState] = useState<"idle" | "loading" | "error">("idle");
  const [strategyError, setStrategyError] = useState("");
  const [bridge, setBridge] = useState<BridgeHealth>("checking");
  const [captured, setCaptured] = useState<CapturedIdea[]>([]);

  const rankedSignals = useMemo(
    () => (live ? outlierScorer : demoScorer).rank(signals, creators, live ? new Date() : new Date("2026-08-22T16:00:00.000Z")),
    [creators, signals, live],
  );

  /** Evidence is the stored corpus only. Demo fixtures never reach the Strategy-Provider. */
  const evidence = useMemo(
    () => (live ? selectEvidence(rankedSignals, creators, { now: Date.now() }) : []),
    [live, rankedSignals, creators],
  );

  const activeNav = navItems.find((item) => item.id === activeTab) ?? navItems[0];
  const ActiveIcon = activeNav.icon;

  async function refreshDemo() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const response = await fetch("/api/refresh", { method: "POST" });
      if (response.ok) {
        const result = (await response.json()) as RefreshResult;
        await Promise.all([loadStore(), loadRuns()]);
        const failed = result.errors?.length ?? 0;
        if (failed === 0) setLastRefresh("Refreshed just now");
        else if (failed >= result.creatorsChecked) setLastRefresh("Refresh failed");
        else setLastRefresh(`Refreshed with ${failed} of ${result.creatorsChecked} creators failing`);
      } else {
        setLastRefresh("Refresh failed");
        await loadRuns();
      }
    } catch {
      setLastRefresh("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function addCreator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const handle = String(form.get("handle") || "").trim().replace(/^@/, "");
    const network = String(form.get("network") || "youtube") as Network;
    if (!handle) return;

    if (network === "instagram") {
      setAddState("loading");
      try {
        const response = await fetch("/api/creators", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle, network }),
        });
        if (!response.ok) throw new Error(await response.text());
        await loadStore();
        setAddState("idle");
        setShowAddCreator(false);
      } catch {
        setAddState("error");
      }
      return;
    }

    setCreators((current) => [
      ...current,
      {
        id: `creator-${handle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: handle
          .split(/[._-]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        handle: `@${handle}`,
        network,
        audience: 0,
        accent: "#ff6546",
      },
    ]);
    setShowAddCreator(false);
  }

  async function generateStrategy(input: { idea: string; goal: string }) {
    if (!live) {
      setStrategyState("error");
      setStrategyError(
        "The corpus is empty, the cards show demo fixtures. Add a creator to the watchlist first.",
      );
      return;
    }
    if (evidence.length === 0) {
      setStrategyState("error");
      setStrategyError(
        `No reel above ${OUTLIER_THRESHOLD}x outlier in the last ${STRATEGY_EVIDENCE_WINDOW_DAYS} days. Refresh, then try again.`,
      );
      return;
    }

    setStrategyState("loading");
    setStrategy(null);
    setStrategyError("");

    const goal = [STRATEGY_GOAL, input.goal.trim(), input.idea.trim() && `Working idea: ${input.idea.trim()}`]
      .filter(Boolean)
      .join(" ");

    try {
      const response = await fetch(`${bridgeUrl}/v1/strategy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal, audience: STRATEGY_AUDIENCE, evidence }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `The bridge answered with HTTP ${response.status}.`);
      }
      setStrategy((await response.json()) as StrategyResponse);
      setStrategyState("idle");
    } catch (error) {
      setStrategyState("error");
      setStrategyError(error instanceof Error ? error.message : "The bridge is unreachable.");
      checkBridge();
    }
  }

  function captureIdea() {
    if (!strategy) return;
    setCaptured((current) => [
      {
        ...strategy,
        id: `idea-${current.length + 1}-${strategy.angle.slice(0, 24)}`,
        capturedAt: new Date().toISOString(),
        evidenceCount: evidence.length,
      },
      ...current,
    ]);
  }

  const knownVideos = rankedSignals.length;
  const nowMs = Date.now();
  const newIn48 = rankedSignals.filter((signal) => isNew(signal.publishedAt, nowMs)).length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setActiveTab("discover")} aria-label="Open Discover">
          <span className="brand-mark"><Pulse size={26} weight="bold" /></span>
          <span>
            <strong>Signal Room</strong>
            <small>Intelligence desk</small>
          </span>
        </button>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeTab === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setActiveTab(item.id)}
              >
                <Icon size={15} weight={activeTab === item.id ? "fill" : "regular"} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="topbar-actions">
          <button className="icon-button" onClick={refreshDemo} disabled={refreshing} aria-label="Refresh">
            <ArrowsClockwise className={refreshing ? "spin" : ""} size={17} />
          </button>
          <button className="icon-button" onClick={() => setActiveTab("profile")} aria-label="Open profile">
            <UserCircle size={20} />
          </button>
        </div>
      </header>

      <main>
        {activeTab === "discover" && (
          <DiscoverView
            rankedSignals={rankedSignals}
            creators={creators}
            network={network}
            onNetwork={setNetwork}
            lastRefresh={lastRefresh}
            stats={{ knownVideos, newIn48 }}
            threshold={threshold}
            onThreshold={setThreshold}
          />
        )}
        {activeTab === "briefing" && <BriefingView rankedSignals={rankedSignals} creators={creators} />}
        {activeTab === "radar" && <RadarView rankedSignals={rankedSignals} />}
        {activeTab === "formats" && <FormatsView rankedSignals={rankedSignals} threshold={threshold} />}
        {activeTab === "channels" && (
          <ChannelsView
            creators={creators}
            rankedSignals={rankedSignals}
            network={network}
            onNetwork={setNetwork}
            onAdd={() => setShowAddCreator(true)}
            issues={runs[0]?.errors.length ?? 0}
          />
        )}
        {activeTab === "ideas" && (
          <IdeasView
            strategy={{ result: strategy, phase: strategyState, error: strategyError, evidence }}
            live={live}
            bridge={bridge}
            captured={captured}
            onGenerate={generateStrategy}
            onRecheckBridge={checkBridge}
            onCapture={captureIdea}
          />
        )}
        {activeTab === "thumbnails" && <ThumbnailsView />}
        {activeTab === "titles" && <TitlesView />}
        {activeTab === "profile" && <ProfileView creators={creators} rankedSignals={rankedSignals} runs={runs} runsState={runsState} />}
      </main>

      {showAddCreator && <AddCreatorDialog onClose={() => setShowAddCreator(false)} onSubmit={addCreator} state={addState} />}
    </div>
  );
}

function NetworkToggle({ network, onNetwork }: { network: Network; onNetwork: (network: Network) => void }) {
  return (
    <div className="pill-group" role="tablist" aria-label="Network">
      <button className={network === "youtube" ? "active" : ""} onClick={() => onNetwork("youtube")}>
        <YoutubeLogo size={14} weight="fill" /> YouTube
      </button>
      <button className={network === "instagram" ? "active" : ""} onClick={() => onNetwork("instagram")}>
        <InstagramLogo size={14} /> IG
      </button>
    </div>
  );
}

function DiscoverView({
  rankedSignals,
  creators,
  network,
  onNetwork,
  lastRefresh,
  stats,
  threshold,
  onThreshold,
}: {
  rankedSignals: Ranked[];
  creators: Creator[];
  network: Network;
  onNetwork: (network: Network) => void;
  lastRefresh: string;
  stats: { knownVideos: number; newIn48: number };
  threshold: OutlierThreshold;
  onThreshold: (threshold: OutlierThreshold) => void;
}) {
  const [view, setView] = useState<DiscoverViewMode>("all");
  const [published, setPublished] = useState<PublishedWindow>("90");
  const [channel, setChannel] = useState("all");
  const [sort, setSort] = useState<"newest" | "outlier" | "views">("newest");
  const [perPage, setPerPage] = useState(24);
  const [cols, setCols] = useState(4);

  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
  const networkCreators = creators.filter((creator) => creator.network === network);
  const nowMs = Date.now();

  const filters = { network, creatorId: channel, published, now: nowMs, threshold };
  // Counter and outlier view share one predicate, so the stat block always equals the card count.
  const outliers = countOutliers(rankedSignals, creators, filters);
  const filtered = filterDiscover(rankedSignals, creators, { ...filters, view })
    .sort((a, b) => {
      if (sort === "outlier") return (b.outlier ?? 0) - (a.outlier ?? 0);
      if (sort === "views") return (b.plays ?? b.views) - (a.plays ?? a.views);
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

  const shown = filtered.slice(0, perPage);
  const isIg = network === "instagram";

  return (
    <div className="view-stack">
      <div className="desk-toolbar">
        <NetworkToggle network={network} onNetwork={onNetwork} />
        <div className="toolbar-facts">
          <span><strong>{stats.knownVideos}</strong> videos</span>
          <span><strong>{creators.length}</strong> channels</span>
          <span><strong>{rankedSignals.filter((s) => s.coverUrl).length}</strong> visual reads</span>
          <span>{lastRefresh}</span>
        </div>
      </div>

      <section className="hero">
        <div>
          <p className="hero-kicker">Tracked {isIg ? "Instagram" : "AI"} channels / updated daily</p>
          <h1>{isIg ? "Instagram content feed" : "Competitor video feed"}</h1>
          <p className="hero-sub">
            Every tracked upload lives in one place, newest first. Switch to Outliers when you want performance analysis instead of a chronological feed.
          </p>
        </div>
        <div className="stat-blocks">
          <div><strong>{stats.knownVideos}</strong><span>known videos</span></div>
          <div><strong>{stats.newIn48}</strong><span>new in 48h</span></div>
          <div className="lime"><strong>{outliers}</strong><span>{formatThreshold(threshold)}+ outliers</span></div>
        </div>
      </section>

      <section className="filter-bar" aria-label="Filters">
        <div>
          <span className="filter-label">View</span>
          <div className="view-toggle">
            <button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>All videos</button>
            <button className={view === "outliers" ? "active" : ""} onClick={() => setView("outliers")}>Outliers</button>
            <button className={view === "saved" ? "active" : ""} onClick={() => setView("saved")}>Saved</button>
          </div>
          <p className="filter-hint">{view === "outliers" ? "Ranked by follower-relative reach" : "Newest uploads first"}</p>
        </div>
        <div>
          <label htmlFor="f-published">Published</label>
          <select id="f-published" value={published} onChange={(e) => setPublished(e.target.value as PublishedWindow)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-channel">Channel</label>
          <select id="f-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">All tracked channels</option>
            {networkCreators.map((creator) => (
              <option key={creator.id} value={creator.id}>{creator.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-sort">Sort by</label>
          <select id="f-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="newest">Newest first</option>
            <option value="outlier">Strongest outlier</option>
            <option value="views">Most {isIg ? "plays" : "views"}</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-threshold">Outlier threshold</label>
          <select id="f-threshold" value={threshold} onChange={(e) => onThreshold(Number(e.target.value) as OutlierThreshold)}>
            {OUTLIER_THRESHOLDS.map((value) => (
              <option key={value} value={value}>{formatThreshold(value)} audience</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-perpage">Videos per page</label>
          <select id="f-perpage" value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
            <option value={12}>12 videos</option>
            <option value={24}>24 videos</option>
            <option value={48}>48 videos</option>
          </select>
        </div>
        <div className="filter-matches">
          <strong>{filtered.length}</strong>
          <span>matches</span>
        </div>
      </section>

      <div className="results-row">
        <span>Showing {filtered.length === 0 ? 0 : 1}–{shown.length} of {filtered.length} videos</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          Videos per row
          <span className="pill-group">
            {[3, 4, 5].map((n) => (
              <button key={n} className={cols === n ? "active" : ""} onClick={() => setCols(n)}>{n}</button>
            ))}
          </span>
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="empty-state">
          {view === "saved"
            ? "No saved videos yet."
            : `No ${isIg ? "Instagram" : "YouTube"} uploads match these filters. Add a creator under Tracked Channels.`}
        </div>
      ) : (
        <div className={`signal-grid cols-${cols}`}>
          {shown.map((signal, index) => {
            const creator = creatorMap.get(signal.creatorId);
            if (!creator) return null;
            const reach = signal.plays ?? signal.views;
            return (
              <article className="signal-card" key={signal.id}>
                <SignalMedia signal={signal} index={index} threshold={threshold} />
                <div className="signal-content">
                  <div className="signal-meta">
                    <span>{creator.handle}</span>
                    <span>{timeAgo(signal.publishedAt, nowMs)}</span>
                    <span>{signal.topic}</span>
                  </div>
                  <h2>{signal.title}</h2>
                  <p>{signal.caption ?? signal.reason}</p>
                  <div className="signal-stats">
                    <span><strong>{formatNumber(reach)}</strong> {isIg ? "plays" : "views"}</span>
                    <span><strong>{formatNumber(signal.likes)}</strong> likes</span>
                    <span><strong>{formatNumber(signal.comments)}</strong> comments</span>
                    <span><strong className="lime">{(signal.outlier ?? 0).toFixed(1)}x</strong></span>
                  </div>
                  {signal.url && (
                    <a className="signal-link" href={signal.url} target="_blank" rel="noreferrer">
                      Open on {isIg ? "Instagram" : "YouTube"} <ArrowSquareOut size={11} />
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <aside className="explain-note">
        <WarningCircle size={20} weight="fill" />
        <div><strong>Designed for replacement</strong><p>{DEMO_SCORING_NOTE}</p></div>
      </aside>
    </div>
  );
}

function BriefingView({ rankedSignals, creators }: { rankedSignals: Ranked[]; creators: Creator[] }) {
  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
  const top = [...rankedSignals].sort((a, b) => b.score - a.score).slice(0, 10);
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Editorial desk / last 24 hours</p>
          <h1>Morning briefing</h1>
          <p className="hero-sub">
            {date}. A ranked reading list across competitor uploads, GitHub momentum, and X conversations, with one angle per package.
          </p>
        </div>
        <div className="stat-blocks">
          <div><strong>{top.length}</strong><span>ranked signals</span></div>
          <div><strong>{new Set(top.map((s) => creatorMap.get(s.creatorId)?.network)).size}</strong><span>sources</span></div>
          <div className="lime"><strong>{top[0]?.score ?? 0}</strong><span>top score</span></div>
        </div>
      </section>

      <div className="briefing-list">
        {top.map((signal, index) => {
          const creator = creatorMap.get(signal.creatorId);
          return (
            <article className={index === 0 ? "brief-row top" : "brief-row"} key={signal.id}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <CoverImage signal={signal} index={index} className="mini" />
              <div>
                <div className="meta">
                  <span>{creator?.network ?? "source"}</span>
                  <strong>{signal.score}</strong>
                </div>
                <h3>{signal.title}</h3>
                <p>{creator?.name}: {signal.caption ?? signal.reason}</p>
                <div className="angle"><span>Your angle</span>Find the uncopied tension behind this package, then show a stronger firsthand proof for your audience.</div>
              </div>
              <div className="actions">
                <button className="ghost-button"><Lightbulb size={13} /> Create idea</button>
                {signal.url && (
                  <a className="ghost-button" href={signal.url} target="_blank" rel="noreferrer" aria-label="Open source"><ArrowSquareOut size={13} /></a>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function RadarView({ rankedSignals }: { rankedSignals: Ranked[] }) {
  const topics = Array.from(new Set(rankedSignals.map((signal) => signal.topic))).map((topic) => {
    const signals = rankedSignals.filter((signal) => signal.topic === topic);
    const momentum = Math.round(signals.reduce((sum, signal) => sum + signal.score, 0) / signals.length);
    const velocity = Math.round(signals.reduce((sum, signal) => sum + signal.velocity, 0) / signals.length);
    return { topic, count: signals.length, momentum, velocity, lead: signals[0].title };
  }).sort((a, b) => b.momentum - a.momentum);

  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Momentum desk / whitespace finder</p>
          <h1>Trend Radar</h1>
          <p className="hero-sub">Topic clusters ranked by momentum, then checked for coverage gaps. High opportunity means the wave is forming and you have not published on it yet.</p>
        </div>
        <div className="stat-blocks">
          <div><strong>{topics.length}</strong><span>topic clusters</span></div>
          <div><strong>{rankedSignals.length}</strong><span>signals read</span></div>
          <div className="lime"><strong>{topics[0]?.momentum ?? 0}</strong><span>lead momentum</span></div>
        </div>
      </section>

      <div className="section-head">
        <div><p className="kicker">Topic opportunities</p><h2>Clusters with proof behind the momentum</h2></div>
        <p className="note">Opportunity uses momentum against your own coverage. Nearest-coverage names the closest thing you already published.</p>
      </div>
      <div className="radar-rows">
        {topics.map((topic, index) => (
          <article className="radar-row" key={topic.topic}>
            <span className="rank">{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{topic.topic}</h3><span className="tag">{topic.count} signals</span></div>
            <p>Lead: {topic.lead}</p>
            <div className="metric lime"><strong>{topic.momentum}</strong><span>opportunity</span></div>
            <div className="metric"><strong>{topic.velocity}</strong><span>velocity</span></div>
            <div className="metric"><strong>{topic.count}</strong><span>channels</span></div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ values, lime }: { values: number[]; lime?: boolean }) {
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${40 - (v / max) * 36}`).join(" ");
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={lime ? "#b9ff5c" : "#8fd93a"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,40 ${points} 100,40`} fill="rgba(185,255,92,0.10)" />
    </svg>
  );
}

function FormatsView({ rankedSignals, threshold }: { rankedSignals: Ranked[]; threshold: number }) {
  const formats = [
    ["[Entity]: [Specific Proposition]", "Clarity through specificity"],
    ["Every [X], ranked", "Curiosity gap plus time saved"],
    ["Contrarian explainer", "Name the assumption, test it, replace it"],
    ["Build in public", "Decisions, constraints, one surprising failure"],
  ];
  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Pattern desk / trailing 90 days</p>
          <h1>Format Signals</h1>
          <p className="hero-sub">Repeatable structures pulled from the outlier corpus. A format is only listed once several channels used it and at least one small channel broke out with it.</p>
        </div>
        <div className="stat-blocks">
          <div><strong>{formats.length}</strong><span>formats tracked</span></div>
          <div><strong>{rankedSignals.length}</strong><span>videos read</span></div>
          <div className="lime"><strong>{rankedSignals.filter((s) => isOutlier(s, threshold)).length}</strong><span>{formatThreshold(threshold)}+ outliers</span></div>
        </div>
      </section>

      {formats.map(([title, sub], fi) => {
        const examples = [...rankedSignals].sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0)).slice(fi, fi + 5);
        const avg = examples.length ? examples.reduce((s, x) => s + (x.outlier ?? 0), 0) / examples.length : 0;
        return (
          <section className="format-section" key={title}>
            <div className="format-head">
              <div><h2>{title}</h2><p>{sub}</p></div>
              <div className="facts"><span className="tag" style={{ border: "1px solid var(--line)", padding: "3px 8px", borderRadius: 4 }}>{examples.length} recent</span><span><strong>{avg.toFixed(1)}x</strong> avg</span><span><strong>{examples.length}</strong> videos</span></div>
            </div>
            <div className="format-strip">
              {examples.map((signal, index) => (
                <article key={signal.id}>
                  <SignalMedia signal={signal} index={index} threshold={threshold} />
                  <h3>{signal.title}</h3>
                  <small>{formatNumber(signal.plays ?? signal.views)} views</small>
                </article>
              ))}
            </div>
            <div className="spark-row">
              <div className="spark"><span>Weekly views</span><Sparkline values={examples.map((s) => s.plays ?? s.views)} /></div>
              <div className="spark"><span>Average outlier</span><Sparkline values={examples.map((s) => s.outlier ?? 0)} lime /></div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ChannelsView({
  creators,
  rankedSignals,
  network,
  onNetwork,
  onAdd,
  issues,
}: {
  creators: Creator[];
  rankedSignals: Ranked[];
  network: Network;
  onNetwork: (network: Network) => void;
  onAdd: () => void;
  /** Creators that failed in the most recent run. */
  issues: number;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const nowMs = Date.now();
  const list = creators
    .filter((creator) => creator.network === network)
    .filter((creator) => creator.name.toLowerCase().includes(query.toLowerCase()) || creator.handle.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.audience - a.audience));
  const yt = creators.filter((c) => c.network === "youtube").length;
  const ig = creators.filter((c) => c.network === "instagram").length;
  const checked = creators.filter((c) => c.lastCheckedAt || rankedSignals.some((s) => s.creatorId === c.id)).length;

  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Watchlist / {network === "instagram" ? "Instagram" : "YouTube"}</p>
          <h1>Tracked channels</h1>
          <p className="hero-sub">Add a creator and Signal Room immediately pulls their last 90 days of uploads, then the daily sweep keeps their newest work and performance observations current.</p>
        </div>
        <div className="next-refresh">
          <span>Next refresh</span>
          <strong>Automatic daily collection at 10:17 UTC</strong>
        </div>
      </section>

      <div className="channel-tabs" role="tablist">
        <button className={network === "youtube" ? "active" : ""} onClick={() => onNetwork("youtube")}>
          <YoutubeLogo size={18} weight="fill" />
          <span><strong>YouTube channels</strong><small>{yt} active</small></span>
        </button>
        <button className={network === "instagram" ? "active" : ""} onClick={() => onNetwork("instagram")}>
          <InstagramLogo size={18} />
          <span><strong>IG creators</strong><small>{ig} tracked</small></span>
        </button>
      </div>

      <form
        className="add-row"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd();
        }}
      >
        <div>
          <label htmlFor="add-creator">Add creator</label>
          <input id="add-creator" placeholder={network === "instagram" ? "https://instagram.com/creator" : "https://youtube.com/@creator"} onFocus={onAdd} readOnly />
        </div>
        <button className="primary-button" type="submit"><Plus size={15} weight="bold" /> Add to daily watch</button>
      </form>

      <div className="stat-row">
        <div><strong>{list.length}</strong><span>Active creators</span></div>
        <div><strong>{checked}</strong><span>Checked at least once</span></div>
        <div><strong>{rankedSignals.filter((s) => creators.find((c) => c.id === s.creatorId)?.network === network).length}</strong><span>Videos retained</span></div>
        <div><strong>{issues}</strong><span>Collection issues</span></div>
      </div>

      <div className="table-tools">
        <div className="search-box"><MagnifyingGlass size={14} /><input placeholder="Search creators" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="sort-select">SORT <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="name">Name A to Z</option><option value="audience">Audience</option></select></div>
      </div>

      <table className="desk-table">
        <thead>
          <tr><th>Creator</th><th>Status</th><th className="hide-sm">Corpus</th><th className="hide-sm">Latest video</th><th className="right">Controls</th></tr>
        </thead>
        <tbody>
          {list.map((creator) => {
            const own = rankedSignals.filter((s) => s.creatorId === creator.id).sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
            const reach = own.map((s) => s.plays ?? s.views).sort((a, b) => a - b);
            const median = reach.length ? reach[Math.floor(reach.length / 2)] : 0;
            return (
              <tr key={creator.id}>
                <td>
                  <div className="creator-cell">
                    <span className="creator-avatar" style={{ background: creator.accent }}>
                      {creator.avatarUrl ? <img src={creator.avatarUrl} alt="" referrerPolicy="no-referrer" /> : creator.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div><strong>{creator.name}</strong><small>{creator.handle} · {creator.audience ? `${formatNumber(creator.audience)} ${network === "instagram" ? "followers" : "subs"}` : "Pending"}</small></div>
                  </div>
                </td>
                <td><span className="status-chip"><CheckCircle size={14} weight="fill" /> Watching · {creator.lastCheckedAt ? `checked ${timeAgo(creator.lastCheckedAt, nowMs)}` : "checked 8h ago"}</span></td>
                <td className="hide-sm"><span className="num">{own.length}</span> <span className="muted">videos · {formatNumber(median)} median</span></td>
                <td className="hide-sm"><span className="muted">{own[0]?.title ?? "No uploads retained yet"}</span></td>
                <td>
                  <div className="controls">
                    <button className="icon-button" aria-label="Refresh creator"><ArrowsClockwise size={14} /></button>
                    <button className="icon-button" aria-label="Remove creator"><Trash size={14} /></button>
                    {creator.url && <a className="icon-button" href={creator.url} target="_blank" rel="noreferrer" aria-label="Open channel"><ArrowSquareOut size={14} /></a>}
                  </div>
                </td>
              </tr>
            );
          })}
          {list.length === 0 && (
            <tr><td colSpan={5}><div className="empty-state">No {network === "instagram" ? "Instagram" : "YouTube"} creators tracked yet.</div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** What the user has to do to get the bridge into a usable state. */
const bridgeCopy: Record<BridgeHealth, { label: string; hint: string; tone: "muted" | "ok" | "bad" }> = {
  checking: { label: "Checking the bridge", hint: "One moment.", tone: "muted" },
  online: { label: "Bridge reachable, Codex logged in", hint: "Ready.", tone: "ok" },
  offline: { label: "Bridge not reachable", hint: "Run npm run bridge in a second terminal.", tone: "bad" },
  "logged-out": { label: "Codex not logged in", hint: "Run codex login in a terminal, then check again.", tone: "bad" },
};

function IdeasView({
  strategy,
  live,
  bridge,
  captured,
  onGenerate,
  onRecheckBridge,
  onCapture,
}: {
  strategy: StrategyState;
  live: boolean;
  bridge: BridgeHealth;
  captured: CapturedIdea[];
  onGenerate: (input: { idea: string; goal: string }) => void;
  onRecheckBridge: () => void;
  onCapture: () => void;
}) {
  const [idea, setIdea] = useState("");
  const [goal, setGoal] = useState("");
  const status = bridgeCopy[bridge];
  const { result, phase, error, evidence } = strategy;
  const blocked = bridge === "offline" || bridge === "logged-out" || phase === "loading";

  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Idea repository / strategy desk</p>
          <h1>Ideas</h1>
          <p className="hero-sub">Capture a working idea, test how it reads as short form and long form, then develop it into a storyboard with the local strategy bridge.</p>
        </div>
        <div className="stat-blocks">
          <div><strong>{captured.length}</strong><span>captured ideas</span></div>
          <div><strong>{evidence.length}</strong><span>outlier reels as evidence</span></div>
          <div className="lime"><strong>{result ? 1 : 0}</strong><span>angles generated</span></div>
        </div>
      </section>

      <section className="panel glow">
        <div className="panel-head">
          <div>
            <p className="kicker">Working idea</p>
            <h2>What are you thinking about making?</h2>
            <p>One line is enough. The goal tells the bridge what the viewer should walk away with.</p>
          </div>
          <div className="control-cluster">
            <div><span>Model</span><select defaultValue="strategy"><option value="strategy">Sol · strategy</option></select></div>
            <div><span>Reasoning</span><select defaultValue="medium"><option>Low</option><option>Medium</option><option>High</option></select></div>
          </div>
        </div>

        <div className={`bridge-status ${status.tone}`}>
          <span className="dot" aria-hidden="true" />
          <div>
            <strong>{status.label}</strong>
            <p>{status.hint}</p>
          </div>
          <button className="ghost-button" type="button" onClick={onRecheckBridge}>
            <ArrowsClockwise size={13} /> Check again
          </button>
        </div>

        <div className="evidence-note">
          {live ? (
            <>
              <strong>{evidence.length} of at most {STRATEGY_EVIDENCE_LIMIT} outlier reels</strong>
              <span>
                from {OUTLIER_THRESHOLD}x outlier up, last {STRATEGY_EVIDENCE_WINDOW_DAYS} days
                {evidence.length > 0 && `: ${[...new Set(evidence.map((item) => item.creator))].join(", ")}`}
              </span>
            </>
          ) : (
            <>
              <strong>No corpus</strong>
              <span>The cards show demo fixtures. The strategy bridge never sees them.</span>
            </>
          )}
        </div>

        <div className="panel-body">
          <div>
            <label htmlFor="idea-text">Idea</label>
            <textarea id="idea-text" placeholder="Paste the premise, a hook, or the thing you noticed." value={idea} onChange={(e) => setIdea(e.target.value)} />
            <p className="count">{idea.length} characters</p>
          </div>
          <div>
            <label htmlFor="idea-goal">Goal · optional</label>
            <textarea id="idea-goal" placeholder="What should the viewer be able to do after watching?" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
        </div>
        <div className="panel-foot">
          <span>Uses the local strategy bridge. Nothing is sent to an API key.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="secondary-button" type="button" onClick={onCapture} disabled={!result}>Capture idea</button>
            <button className="primary-button" type="button" onClick={() => onGenerate({ idea, goal })} disabled={blocked}>Generate angle <ArrowRight size={15} /></button>
          </div>
        </div>
        {phase === "loading" && <div className="strategy-loading"><span /><span /><span /><p>Reading the evidence packet</p></div>}
        {phase === "error" && (
          <div className="strategy-error">
            <WarningCircle size={20} weight="fill" />
            <h3>No angle</h3>
            <p>{error || "The bridge is unreachable."}</p>
            <div><button className="secondary-button" onClick={() => onGenerate({ idea, goal })}>Try again</button></div>
          </div>
        )}
        {result && (
          <div className="strategy-result">
            <span>Suggested angle from {evidence.length} outlier reels</span>
            <h3>{result.angle}</h3>
            <p>{result.rationale}</p>
            <dl>
              <dt>Opening</dt><dd>{result.opening}</dd>
              <dt>Proof to show</dt><dd>{result.proofToShow.join(", ")}</dd>
              <dt>Cautions</dt><dd>{result.cautions.join(", ")}</dd>
            </dl>
            <div><button className="secondary-button" type="button" onClick={onCapture}>Capture idea</button></div>
          </div>
        )}
      </section>

      {captured.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="kicker">Captured ideas</p>
              <h2>This session</h2>
              <p>Writing them to the ideas table lands with ticket 08.</p>
            </div>
          </div>
          {captured.map((item, index) => (
            <div className="idea-row" key={item.id}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <div><small>{item.evidenceCount} reels as evidence</small><h3>{item.angle}</h3></div>
              <span className="state">Not saved</span>
            </div>
          ))}
        </section>
      )}

      <div className="idea-columns">
        <section>
          <header>Long form <span>{demoIdeas.length}</span></header>
          {demoIdeas.map((item, index) => (
            <div className="idea-row" key={item.id}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <div><small>{item.format}</small><h3>{item.title}</h3></div>
              <span className="state">{item.state}</span>
            </div>
          ))}
        </section>
        <section>
          <header>Short form <span>{demoIdeas.length}</span></header>
          {demoIdeas.map((item, index) => (
            <div className="idea-row" key={item.id}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <div><small>{item.format}</small><h3>{item.title.split(" ").slice(0, 5).join(" ")} in 45 seconds</h3></div>
              <span className="state">{item.evidence} sources</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function ThumbnailsView() {
  const [treatment, setTreatment] = useState<"faceless" | "face">("faceless");
  const [idea, setIdea] = useState("");
  const packages = [
    ["Claude Code Won't Save You Without This System", "A dark faceless control panel with three connected job cards, a bright approval checkpoint, and one red blocked handoff."],
    ["Claude Code Ran My Workday. Here Is What Broke", "A charcoal-black scoreboard labeled with three simple icons for research, content, and reporting."],
    ["One Object, One Contrast", "A single inspectable object on a near-black field, four words or fewer, no interface collage."],
  ];
  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Thumbnail lab / visual direction</p>
          <h1>Thumbnail Lab</h1>
          <p className="hero-sub">Turn an idea into a traceable visual asset. Three packages per idea, each with a prompt you can read before anything is rendered.</p>
        </div>
        <div className="stat-blocks">
          <div><strong>{packages.length}</strong><span>packages</span></div>
          <div><strong>0</strong><span>rendered</span></div>
          <div className="lime"><strong>4:5</strong><span>reel cover ratio</span></div>
        </div>
      </section>

      <section className="panel glow">
        <div className="panel-head">
          <div><p className="kicker">Idea</p><h2>What should the cover promise?</h2><p>Keep it to one thought. The lab adds the constraints.</p></div>
          <div className="next-refresh"><span>No separate API key</span><strong>Uses the saved local sign-in and included usage limits.</strong></div>
        </div>
        <div className="panel-body">
          <div>
            <label htmlFor="thumb-idea">Idea</label>
            <textarea id="thumb-idea" placeholder="Make an image of me pointing at Claude Code. Very dark themed." value={idea} onChange={(e) => setIdea(e.target.value)} />
          </div>
          <div>
            <label>Visual treatment</label>
            <div className="option-tiles">
              <button type="button" className={treatment === "faceless" ? "option-tile active" : "option-tile"} onClick={() => setTreatment("faceless")}><strong>Faceless</strong><span>Default · let the proof object carry the click</span></button>
              <button type="button" className={treatment === "face" ? "option-tile active" : "option-tile"} onClick={() => setTreatment("face")}><strong>Use my face</strong><span>Only when expression adds essential meaning</span></button>
            </div>
          </div>
        </div>
        <div className="panel-foot">
          <span>Constraints: one object, high figure-ground contrast, four words or fewer, no interface collage.</span>
          <button className="primary-button" type="button"><Plus size={15} weight="bold" /> Create thumbnail project</button>
        </div>
      </section>

      <div className="section-head"><div><p className="kicker">Thumbnail lab · {packages.length} packages · 0 rendered</p><h2>Packages</h2></div></div>
      <div className="panel">
        {packages.map(([title, prompt], index) => (
          <div className="idea-row" key={title}>
            <span className="rank">{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{title}</h3><p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 11.5, lineHeight: 1.5 }}>{prompt}</p></div>
            <button className="secondary-button" type="button"><ImageSquare size={14} /> Generate thumbnail</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TitlesView() {
  const [source, setSource] = useState("");
  const [direction, setDirection] = useState("");
  const history = [
    ["Aug 11", "Transcript", "10 titles", "part 1, free websites. So this entire website, from the beautiful backdrop that you're seeing.", 28053],
    ["Aug 8", "Transcript", "15 titles", "recording video. A few weeks ago, something became very clear.", 26184],
    ["Aug 6", "One liner", "15 titles", "how to replace your ai subscription with this one simple trick", 77],
    ["Aug 6", "One liner", "5 titles", "A video about the one Claude Code habit that separates people who ship from people who keep restarting.", 229],
  ] as const;
  const titles = [
    ["I Let an Agent Run the Workflow", "Curiosity"],
    ["The Memory Layer You Can Actually Inspect", "Clarity"],
    ["Stop Hiding the Receipts", "Contrarian"],
    ["A Small-Team AI System That Survives Monday", "Utility"],
  ];
  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Title lab / evidence backed</p>
          <h1>Title board</h1>
          <p className="hero-sub">Paste the transcript, the idea, or the one line you have. The desk reads it against your published titles and the tracked outlier corpus, then returns candidates grouped by the hypothesis each one is testing.</p>
        </div>
        <div className="stat-blocks">
          <div><strong>{history.length}</strong><span>saved boards</span></div>
          <div><strong>10</strong><span>titles per run</span></div>
          <div><strong>45-55</strong><span>target characters</span></div>
        </div>
      </section>

      <div className="two-col">
        <section className="panel glow">
          <div className="panel-head">
            <div><p className="kicker">Source material</p><h2>What is this video actually about</h2><p>Longer input produces sharper titles. A full transcript gives the desk the real hook, the real proof, and the real payoff to write against.</p></div>
            <div className="control-cluster">
              <div><span>Model</span><select defaultValue="strategy"><option value="strategy">Sol · strategy</option></select></div>
              <div><span>Reasoning</span><select defaultValue="medium"><option>Low</option><option>Medium</option><option>High</option></select></div>
              <div><span>Titles</span><select defaultValue="10"><option>5</option><option>10</option><option>15</option></select></div>
            </div>
          </div>
          <div className="panel-body">
            <div>
              <label htmlFor="title-source">Transcript, idea, or one liner</label>
              <textarea id="title-source" style={{ minHeight: 180 }} placeholder="Paste the full transcript here, or write the premise in a sentence." value={source} onChange={(e) => setSource(e.target.value)} />
              <p className="count">{source.length} characters</p>
            </div>
            <div>
              <label htmlFor="title-direction">Direction · optional</label>
              <textarea id="title-direction" placeholder="Angle it at agencies. Keep the Claude Code keyword in front." value={direction} onChange={(e) => setDirection(e.target.value)} />
            </div>
          </div>
          <div className="panel-foot">
            <span>Uses the local strategy bridge. Nothing is sent to an API key.</span>
            <button className="primary-button" type="button">Generate titles</button>
          </div>
          <div className="panel" style={{ border: 0, borderTop: "1px solid var(--line)", borderRadius: 0 }}>
            {titles.map(([title, intent], index) => (
              <div className="idea-row" key={title}>
                <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                <div><small>{intent}</small><h3>{title}</h3></div>
                <button className="icon-button" aria-label={`Open ${title}`}><ArrowRight size={14} /></button>
              </div>
            ))}
          </div>
        </section>
        <aside className="history-rail">
          <div className="rail-head"><span>History</span><span>{history.length} saved</span></div>
          {history.map(([when, kind, count, excerpt, chars]) => (
            <article key={`${when}-${excerpt}`}>
              <div><div className="when">{when} · {kind}<strong>{count}</strong></div><p>{excerpt}</p></div>
              <span className="num">{formatNumber(chars)}</span>
            </article>
          ))}
        </aside>
      </div>
    </div>
  );
}

function ProfileView({ creators, rankedSignals, runs, runsState }: { creators: Creator[]; rankedSignals: Ranked[]; runs: Run[]; runsState: "loading" | "ready" | "error" }) {
  const owned = creators.filter((c) => c.owned);
  const ownedIds = new Set(owned.map((c) => c.id));
  const nowMs = Date.now();
  const mine = rankedSignals.filter((s) => ownedIds.has(s.creatorId)).sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Owned performance / separate from research</p>
          <h1>Profile</h1>
          <p className="hero-sub">Your own lanes, tracked with the same outlier math as the competitor corpus. Find the last banger, then work out what made it one.</p>
        </div>
        <div className="stat-blocks">
          <div><strong>{owned.length}</strong><span>owned lanes</span></div>
          <div><strong>{mine.length}</strong><span>videos tracked</span></div>
          <div className="lime"><strong>{(Math.max(0, ...mine.map((s) => s.outlier ?? 0))).toFixed(2)}x</strong><span>strongest outlier</span></div>
        </div>
      </section>

      <section className="profile-head">
        <span className="profile-mark">SR</span>
        <div><h2>Your signal room</h2><p>Adapters decide the data source, the ranking method, and the strategy provider.</p></div>
        <span className="demo-badge">{owned.length ? "Owned lanes connected" : "No owned lane yet"}</span>
      </section>

      <div className="settings-grid">
        <div><span>Data source</span><strong>Apify connector</strong></div>
        <div><span>Ranking method</span><strong>Follower-relative outlier</strong></div>
        <div><span>Tracked channels</span><strong>{creators.length}</strong></div>
        <div><span>Strategy bridge</span><strong>Local and optional</strong></div>
      </div>

      <div className="section-head"><div><p className="kicker">Recent performance</p><h2>Every owned upload</h2></div><p className="note">Add your own handle under Tracked Channels with the owned flag to populate this table.</p></div>
      <table className="desk-table">
        <thead><tr><th>Video</th><th className="hide-sm">Published</th><th className="right">Views</th><th className="right">Outlier</th></tr></thead>
        <tbody>
          {mine.map((signal) => (
            <tr key={signal.id}>
              <td><div className="thumb-cell">{signal.coverUrl ? <img className="mini" src={signal.coverUrl} alt="" /> : <span className="mini" />}<div><strong>{signal.title}</strong><small>{signal.format ?? "video"}</small></div></div></td>
              <td className="hide-sm muted">{timeAgo(signal.publishedAt, nowMs)}</td>
              <td className="right num">{formatNumber(signal.plays ?? signal.views)}</td>
              <td className="right lime">{(signal.outlier ?? 0).toFixed(2)}x</td>
            </tr>
          ))}
          {mine.length === 0 && <tr><td colSpan={4}><div className="empty-state">No owned uploads yet.</div></td></tr>}
        </tbody>
      </table>

      <div className="section-head"><div><p className="kicker">Collection log</p><h2>Last runs</h2></div><p className="note">Every refresh is logged: window, counts, and which creators failed. A failing creator keeps its cursor and is retried next run.</p></div>
      <table className="desk-table">
        <thead><tr><th>Started</th><th>Status</th><th className="hide-sm">Duration</th><th className="right">Creators</th><th className="right">New</th><th className="right">Updated</th><th className="hide-sm">Errors</th></tr></thead>
        <tbody>
          {runs.slice(0, 10).map((run) => (
            <tr key={run.id}>
              <td><strong>{formatStarted(run.startedAt)}</strong><br /><small className="muted">{run.kind}</small></td>
              <td><span className={`status-chip run-${run.status}`}>{run.status === "ok" ? <CheckCircle size={14} weight="fill" /> : <WarningCircle size={14} weight="fill" />} {run.status}</span></td>
              <td className="hide-sm muted">{formatDuration(run.durationMs)}</td>
              <td className="right num">{run.creatorsChecked}</td>
              <td className="right num">{run.recordsAdded}</td>
              <td className="right num">{run.recordsUpdated}</td>
              <td className="hide-sm muted">{run.errors.length === 0 ? "—" : run.errors.map((e) => `${e.handle}: ${e.message}`).join(" · ")}</td>
            </tr>
          ))}
          {runsState === "loading" && runs.length === 0 && <tr><td colSpan={7}><div className="empty-state">Loading runs…</div></td></tr>}
          {runsState === "error" && <tr><td colSpan={7}><div className="empty-state">Run log unavailable. Reload to try again.</div></td></tr>}
          {runsState === "ready" && runs.length === 0 && <tr><td colSpan={7}><div className="empty-state">No runs yet. Hit refresh to log the first one.</div></td></tr>}
        </tbody>
      </table>

      <aside className="explain-note"><WarningCircle size={20} weight="fill" /><div><strong>Bring your own advantage</strong><p>Private prompts, source lists, thresholds, audience theory, and scoring logic belong in your own adapters and private environment.</p></div></aside>
    </div>
  );
}

function AddCreatorDialog({ onClose, onSubmit, state }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; state: "idle" | "loading" | "error" }) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading"><div><p>Add to daily watch</p><h2 id="dialog-title">Track a public channel</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <form onSubmit={onSubmit}>
          <label><span>Channel handle</span><input name="handle" placeholder="@usefulcreator" autoFocus required /><small>The connector resolves the handle and pulls the last 90 days.</small></label>
          <label><span>Network</span><select name="network" defaultValue="instagram"><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select></label>
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={state === "loading"}>{state === "loading" ? "Backfilling 90 days via Apify…" : state === "error" ? "Failed, retry" : "Add to daily watch"}<ArrowRight size={15} /></button></div>
        </form>
      </div>
    </div>
  );
}
