"use client";

import {
  ArrowRight,
  ArrowsClockwise,
  Binoculars,
  ChartLineUp,
  Globe,
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
import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CoverImage, formatNumber, formatOutlier, networkName, timeAgo } from "@/components/display";
import { TAB_PARAM, creatorPath, creatorStats } from "@/lib/creator-detail";
import { rankCorpus, DEMO_NOW, type Ranked } from "@/lib/rank-corpus";
import { demoCreators, demoIdeas, demoSignals } from "@/lib/demo-data";
import { DEMO_SCORING_NOTE } from "@/lib/demo-score";
import {
  DEFAULT_OUTLIER_THRESHOLD,
  OUTLIER_THRESHOLDS,
  countOutliers,
  filterDiscover,
  isOutlier,
  isOwned,
  storeOrDemo,
  withoutOwned,
  type DiscoverView as DiscoverViewMode,
  type OutlierThreshold,
  type PublishedWindow,
} from "@/lib/discover-filter";
import { buildBriefing } from "@/lib/briefing";
import {
  BRIEFING_LIMIT,
  BRIEFING_WINDOW_HOURS,
  FORMAT_REVIEW_RISING_LIMIT,
  FORMAT_REVIEW_SMALL_AUDIENCE,
  FORMAT_WINDOW_DAYS,
  HOOK_COUNTS,
  HOOK_INPUT_MAX,
  HOOK_RUN_HISTORY,
  OUTLIER_THRESHOLD,
  STRATEGY_AUDIENCE,
  STRATEGY_BRIDGE_URL,
  STRATEGY_EVIDENCE_LIMIT,
  STRATEGY_EVIDENCE_WINDOW_DAYS,
  STRATEGY_GOAL,
} from "@/lib/config";
import { parseHookRequest, type HookRequestInput } from "@/lib/hooks-board";
import type { IdeaInput } from "@/lib/ideas";
import { selectEvidence } from "@/lib/strategy-evidence";
import { UNCLASSIFIED, buildFormatSignals, type FormatSignal } from "@/lib/format-signals";

import type { Briefing, FormatReview, FormatReviewPattern, HookRun, Idea, PatternMove, RefreshResult, Run, SignalRecord } from "@/lib/contracts";
import type { Creator, Network, StrategyEvidenceItem, StrategyResponse } from "@/lib/contracts";

/** Reachability plus Codex login, as reported by the bridge health route. */
type BridgeHealth = "checking" | "online" | "offline" | "logged-out";

/** The ideas repository as the Ideas tab sees it. */
type IdeasState = {
  items: Idea[];
  phase: "loading" | "ready" | "error";
  /** id of the idea whose develop run is in flight, null when none is. */
  developing: string | null;
  error: string;
};

/** The Hooks board as its tab sees it. The runs are the history rail, newest first. */
type HooksState = {
  runs: HookRun[];
  phase: "loading" | "ready" | "error";
  /** Runs in flight. Two starts are two entries, so this counts instead of holding one id. */
  running: number;
  error: string;
  /** id of the run on the board, null reads the newest one. */
  selected: string | null;
};

/** The stored briefings as the Briefing tab sees them, newest first. */
type BriefingState = {
  briefings: Briefing[];
  phase: "loading" | "ready" | "running" | "error";
  /** id of the briefing on screen, null reads the newest one. */
  selected: string | null;
  error: string;
};

/** The monthly Format-Review as the Format Signals tab sees it. */
type ReviewState = {
  review: FormatReview | null;
  phase: "loading" | "ready" | "running" | "error";
};

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
  { id: "hooks", label: "Hooks", icon: TextAa },
  { id: "profile", label: "Profile", icon: UserCircle },
] as const;

type TabId = (typeof navItems)[number]["id"];

function NetworkLabel({ network }: { network: Network }) {
  return <span className="network-label">{networkName(network)}</span>;
}

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

/**
 * Age inside a briefing window, measured against the moment the briefing was
 * composed rather than the reader's clock, so an old document keeps reading right.
 */
function ageInWindow(publishedAt: string, generatedAt: string) {
  const hours = Math.max(0, (new Date(generatedAt).getTime() - new Date(publishedAt).getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  return `${Math.round(hours)}h old`;
}

function formatStamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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

  async function loadIdeas() {
    try {
      const response = await fetch("/api/ideas", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { ideas: Idea[] };
      setIdeas((current) => ({ ...current, items: data.ideas, phase: "ready" }));
    } catch {
      setIdeas((current) => ({ ...current, phase: "error" }));
    }
  }

  async function loadHookRuns() {
    try {
      const response = await fetch("/api/hooks", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { runs: HookRun[] };
      setHooks((current) => ({ ...current, runs: data.runs, phase: "ready" }));
    } catch {
      setHooks((current) => ({ ...current, phase: "error" }));
    }
  }

  async function loadBriefings() {
    try {
      const response = await fetch("/api/briefings", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { briefings: Briefing[] };
      setBriefings((current) => ({ ...current, briefings: data.briefings, phase: "ready" }));
    } catch {
      setBriefings((current) => ({ ...current, phase: "error" }));
    }
  }

  /** The manual pass. Every Delta-Refresh runs the same composition on its own. */
  async function composeBriefingNow() {
    setBriefings((current) => ({ ...current, phase: "running", error: "" }));
    try {
      const response = await fetch("/api/briefings", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { briefing?: Briefing; error?: string };
      if (!response.ok || !payload.briefing) {
        throw new Error(payload.error || `The briefing answered with HTTP ${response.status}.`);
      }
      const briefing = payload.briefing;
      setBriefings((current) => ({
        briefings: [briefing, ...current.briefings.filter((item) => item.id !== briefing.id)],
        phase: "ready",
        selected: briefing.id,
        error: "",
      }));
    } catch (error) {
      setBriefings((current) => ({
        ...current,
        phase: "ready",
        error: error instanceof Error ? error.message : "The briefing could not be composed.",
      }));
    }
  }

  async function loadFormatReview() {
    try {
      const response = await fetch("/api/format-reviews", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { review: FormatReview | null };
      setReview({ review: data.review, phase: "ready" });
    } catch {
      setReview((current) => ({ ...current, phase: "error" }));
    }
  }

  /** The manual pass. The Convex cron runs the same computation on the first of the month. */
  async function runFormatReview() {
    setReview((current) => ({ ...current, phase: "running" }));
    try {
      const response = await fetch("/api/format-reviews", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { review: FormatReview };
      setReview({ review: data.review, phase: "ready" });
    } catch {
      setReview((current) => ({ ...current, phase: "error" }));
    }
  }

  async function checkBridge() {
    setBridge("checking");
    try {
      const response = await fetch(`${STRATEGY_BRIDGE_URL}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = (await response.json()) as { codex?: string };
      setBridge(health.codex === "logged-out" ? "logged-out" : "online");
    } catch {
      setBridge("offline");
    }
  }

  // The detail page links back with ?tab=channels, so the return lands on the list it came from.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get(TAB_PARAM);
    if (navItems.some((item) => item.id === wanted)) setActiveTab(wanted as TabId);
  }, []);

  useEffect(() => {
    loadStore().catch(() => {});
    loadRuns();
    loadIdeas();
    loadHookRuns();
    loadBriefings();
    loadFormatReview();
    checkBridge();
  }, []);
  const [showAddCreator, setShowAddCreator] = useState(false);
  const [strategy, setStrategy] = useState<StrategyResponse | null>(null);
  const [strategyState, setStrategyState] = useState<"idle" | "loading" | "error">("idle");
  const [strategyError, setStrategyError] = useState("");
  const [bridge, setBridge] = useState<BridgeHealth>("checking");
  const [ideas, setIdeas] = useState<IdeasState>({ items: [], phase: "loading", developing: null, error: "" });
  const [briefings, setBriefings] = useState<BriefingState>({
    briefings: [],
    phase: "loading",
    selected: null,
    error: "",
  });
  const [review, setReview] = useState<ReviewState>({ review: null, phase: "loading" });
  const [hooks, setHooks] = useState<HooksState>({ runs: [], phase: "loading", running: 0, error: "", selected: null });

  const rankedSignals = useMemo(() => rankCorpus(signals, creators, live), [creators, signals, live]);

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
        await Promise.all([loadStore(), loadRuns(), loadBriefings()]);
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
    const owned = form.get("owned") === "on";
    if (!handle) return;

    if (network === "instagram") {
      setAddState("loading");
      try {
        const response = await fetch("/api/creators", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle, network, owned }),
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
        ...(owned ? { owned: true } : {}),
      },
    ]);
    setShowAddCreator(false);
  }

  /** One creator mark. Optimistic, and rolled back to the creator we started from when the route says no. */
  async function markCreator(creator: Creator, mark: { owned?: boolean; foreign?: boolean }) {
    setCreators((current) => current.map((item) => (item.id === creator.id ? { ...item, ...mark } : item)));
    try {
      const response = await fetch("/api/creators", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: creator.id, ...mark }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      // Only the marks we sent roll back; anything else that moved meanwhile stays.
      const before = Object.fromEntries(Object.keys(mark).map((key) => [key, creator[key as keyof Creator]]));
      setCreators((current) => current.map((item) => (item.id === creator.id ? { ...item, ...before } : item)));
    }
  }

  /** Flips the foreign-niche mark that splits the Format Signals tab. */
  const toggleForeign = (creator: Creator) => markCreator(creator, { foreign: !creator.foreign });

  /** Flips the owned mark: an owned creator leaves the research views and reads in Profile. */
  const toggleOwned = (creator: Creator) => markCreator(creator, { owned: !isOwned(creator) });

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
      const response = await fetch(`${STRATEGY_BRIDGE_URL}/v1/strategy`, {
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

  /** Capture from the Ideas form or from a card. Both land in the same ideas table. */
  async function captureIdea(input: IdeaInput) {
    const title = input.title.trim();
    if (!title) return;
    setIdeas((current) => ({ ...current, error: "" }));
    try {
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, title }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `The ideas table answered with HTTP ${response.status}.`);
      }
      const { idea } = (await response.json()) as { idea: Idea };
      setIdeas((current) => ({ ...current, items: [idea, ...current.items], phase: "ready" }));
      setActiveTab("ideas");
    } catch (error) {
      setIdeas((current) => ({ ...current, error: error instanceof Error ? error.message : "The capture failed." }));
    }
  }

  /**
   * Develop through the server route, which claims the idea for one run. A second
   * run on the same idea wins, and the slower answer is dropped instead of written.
   */
  async function developIdea(ideaId: string) {
    if (ideas.developing) return;
    setIdeas((current) => ({ ...current, developing: ideaId, error: "" }));
    try {
      const response = await fetch("/api/ideas/develop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ideaId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { idea?: Idea; stale?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || `The develop run answered with HTTP ${response.status}.`);
      if (payload.stale) {
        await loadIdeas();
        return;
      }
      setIdeas((current) => ({
        ...current,
        items: current.items.map((item) => (item.id === ideaId ? payload.idea ?? item : item)),
      }));
    } catch (error) {
      setIdeas((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "The develop run failed.",
      }));
      checkBridge();
    } finally {
      setIdeas((current) => ({ ...current, developing: null }));
    }
  }

  /**
   * One Hooks-Board run. Each start posts on its own and lands as its own entry,
   * so two runs kicked off in parallel both keep their board.
   */
  async function generateHooks(input: { source: string; direction: string; count: number }) {
    let request: HookRequestInput;
    try {
      // The same validation the route runs, so an oversized paste is refused before it travels.
      request = parseHookRequest(input);
    } catch (error) {
      setHooks((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "The input was refused.",
      }));
      return;
    }
    if (!live) {
      setHooks((current) => ({
        ...current,
        error: "The corpus is empty, the cards show demo fixtures. Add a creator to the watchlist first.",
      }));
      return;
    }

    setHooks((current) => ({ ...current, running: current.running + 1, error: "" }));
    try {
      const response = await fetch("/api/hooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = (await response.json().catch(() => ({}))) as { run?: HookRun; error?: string };
      if (!response.ok || !payload.run) {
        throw new Error(payload.error || `The hooks run answered with HTTP ${response.status}.`);
      }
      const run = payload.run;
      setHooks((current) => ({
        ...current,
        runs: [run, ...current.runs.filter((item) => item.id !== run.id)].slice(0, HOOK_RUN_HISTORY),
        selected: run.id,
        phase: "ready",
      }));
    } catch (error) {
      setHooks((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "The hooks run failed.",
      }));
      checkBridge();
    } finally {
      setHooks((current) => ({ ...current, running: Math.max(0, current.running - 1) }));
    }
  }

  // The Discover counters read the same corpus its cards do: own uploads are not in it.
  const research = withoutOwned(rankedSignals, creators);
  const knownVideos = research.length;
  const nowMs = Date.now();
  const newIn48 = research.filter((signal) => isNew(signal.publishedAt, nowMs)).length;

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
            onCreateIdea={captureIdea}
          />
        )}
        {activeTab === "briefing" && (
          <BriefingView
            state={briefings}
            signals={signals}
            creators={creators}
            live={live}
            onCompose={composeBriefingNow}
            onSelect={(id) => setBriefings((current) => ({ ...current, selected: id }))}
            onCreateIdea={captureIdea}
          />
        )}
        {activeTab === "radar" && <RadarView rankedSignals={research} />}
        {activeTab === "formats" && (
          <FormatsView
            rankedSignals={rankedSignals}
            creators={creators}
            threshold={threshold}
            review={review}
            onRunReview={runFormatReview}
          />
        )}
        {activeTab === "channels" && (
          <ChannelsView
            creators={creators}
            rankedSignals={rankedSignals}
            network={network}
            onNetwork={setNetwork}
            onAdd={() => setShowAddCreator(true)}
            onToggleForeign={toggleForeign}
            onToggleOwned={toggleOwned}
            issues={runs[0]?.errors.length ?? 0}
          />
        )}
        {activeTab === "ideas" && (
          <IdeasView
            strategy={{ result: strategy, phase: strategyState, error: strategyError, evidence }}
            live={live}
            bridge={bridge}
            ideas={ideas}
            onGenerate={generateStrategy}
            onRecheckBridge={checkBridge}
            onCapture={captureIdea}
            onDevelop={developIdea}
            onReloadIdeas={loadIdeas}
          />
        )}
        {activeTab === "thumbnails" && <ThumbnailsView />}
        {activeTab === "hooks" && (
          <HooksView
            hooks={hooks}
            live={live}
            bridge={bridge}
            evidence={evidence}
            onGenerate={generateHooks}
            onRecheckBridge={checkBridge}
            onSelect={(id) => setHooks((current) => ({ ...current, selected: id }))}
            onReload={loadHookRuns}
          />
        )}
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
  onCreateIdea,
}: {
  rankedSignals: Ranked[];
  creators: Creator[];
  network: Network;
  onNetwork: (network: Network) => void;
  lastRefresh: string;
  stats: { knownVideos: number; newIn48: number };
  threshold: OutlierThreshold;
  onThreshold: (threshold: OutlierThreshold) => void;
  onCreateIdea: (input: IdeaInput) => void;
}) {
  const [view, setView] = useState<DiscoverViewMode>("all");
  const [published, setPublished] = useState<PublishedWindow>("90");
  const [channel, setChannel] = useState("all");
  const [sort, setSort] = useState<"newest" | "outlier" | "views">("newest");
  const [perPage, setPerPage] = useState(24);
  const [cols, setCols] = useState(4);

  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
  // Every count and picker on this tab reads the same corpus the cards do: no owned creator in it.
  const researchCreators = creators.filter((creator) => !isOwned(creator));
  const researchSignals = withoutOwned(rankedSignals, creators);
  const networkCreators = researchCreators.filter((creator) => creator.network === network);
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
          <span><strong>{researchCreators.length}</strong> channels</span>
          <span><strong>{researchSignals.filter((s) => s.coverUrl).length}</strong> visual reads</span>
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
                    <Link className="creator-link" href={creatorPath(creator.id, { from: "discover", threshold })}>{creator.handle}</Link>
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
                  <div className="signal-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        onCreateIdea({
                          title: signal.title,
                          sourceSignalId: signal.id,
                          sourceCreator: creator.handle,
                          sourceUrl: signal.url,
                        })
                      }
                    >
                      <Lightbulb size={13} /> Create idea
                    </button>
                    {signal.url && (
                      <a className="signal-link" href={signal.url} target="_blank" rel="noreferrer">
                        Open on {isIg ? "Instagram" : "YouTube"} <ArrowSquareOut size={11} />
                      </a>
                    )}
                  </div>
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

/**
 * The Briefing tab: the daily document a Delta-Refresh leaves behind. Older days
 * are pickable; the angle under each reel comes from the Bridge and is simply
 * absent when it was down. Without a stored corpus the same pure composition
 * runs over the demo fixtures, so the tab reads before the first refresh.
 */
function BriefingView({
  state,
  signals,
  creators,
  live,
  onCompose,
  onSelect,
  onCreateIdea,
}: {
  state: BriefingState;
  signals: SignalRecord[];
  creators: Creator[];
  live: boolean;
  onCompose: () => void;
  onSelect: (id: string) => void;
  onCreateIdea: (input: IdeaInput) => void;
}) {
  const stored = state.selected
    ? state.briefings.find((item) => item.id === state.selected) ?? state.briefings[0]
    : state.briefings[0];
  // Demo mode never writes a document. The fixtures run through the same ranking.
  const demo = useMemo(
    () => (stored || live ? null : buildBriefing(signals, creators, { now: DEMO_NOW.getTime() })),
    [stored, live, signals, creators],
  );
  const briefing = stored ?? demo;
  const running = state.phase === "running";
  const items = briefing?.items ?? [];
  const day = briefing ? new Date(`${briefing.day}T12:00:00.000Z`) : new Date();

  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Editorial desk / last {briefing?.windowHours ?? BRIEFING_WINDOW_HOURS} hours</p>
          <h1>{stored ? "Morning briefing" : "Morning briefing (demo)"}</h1>
          <p className="hero-sub">
            {day.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}. The{" "}
            {BRIEFING_LIMIT} strongest reels of the window, ranked by outlier times freshness, with one angle each.
            {briefing && briefing.candidates > items.length
              ? ` ${briefing.candidates - items.length} more reels landed in the window and did not make the cut.`
              : ""}
          </p>
        </div>
        <div className="stat-blocks">
          <div><strong>{items.length}</strong><span>ranked reels</span></div>
          <div><strong>{briefing?.sources ?? 0}</strong><span>sources</span></div>
          <div className="lime"><strong>{items[0]?.score.toFixed(2) ?? "0.00"}</strong><span>top score</span></div>
        </div>
      </section>

      <div className="review-actions">
        <span>
          {state.phase === "loading" && "Loading the briefings…"}
          {state.phase === "error" && "The briefings could not be read."}
          {state.error}
          {!state.error && stored && state.phase !== "loading" && (
            <>
              Composed {formatStamp(stored.generatedAt)}
              {stored.items.length > 0 && !stored.angles && " · no angles: the bridge was unreachable"}
            </>
          )}
          {!state.error && !stored && state.phase === "ready" && (live
            ? "No briefing yet. Every refresh writes one, or compose today's now."
            : "Demo fixtures. Add a creator to the watchlist, then refresh.")}
        </span>
        <div className="brief-controls">
          {state.briefings.length > 1 && (
            <label className="sort-select">
              Day
              <select value={stored?.id ?? ""} onChange={(event) => onSelect(event.target.value)}>
                {state.briefings.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.day} ({item.items.length})
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="ghost-button" onClick={onCompose} disabled={running}>
            {running ? "Composing…" : "Compose briefing"}
          </button>
        </div>
      </div>

      {briefing && items.length === 0 && (
        <p className="empty-note">
          Nothing was published in the last {briefing.windowHours} hours. The next refresh writes the next briefing.
        </p>
      )}

      {items.length > 0 && (
        <div className="briefing-list">
          {items.map((item, index) => (
            <article className={index === 0 ? "brief-row top" : "brief-row"} key={item.signalId}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <CoverImage signal={item} index={index} className="mini" lazy />
              <div>
                <div className="meta">
                  <span>{item.creator}</span>
                  <strong>{item.score.toFixed(2)} score</strong>
                  <span>{formatOutlier(item.outlier)} outlier</span>
                  <span>{formatNumber(item.plays)} plays</span>
                  <span>{ageInWindow(item.publishedAt, briefing?.generatedAt ?? item.publishedAt)}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.creatorName}: {item.caption || "No caption on this reel."}</p>
                <div className="angle">
                  <span>Your angle</span>
                  {item.angle ?? "No angle yet. Compose the briefing again once the bridge is up."}
                </div>
              </div>
              <div className="actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() =>
                    onCreateIdea({
                      title: item.title,
                      ...(item.angle ? { goal: item.angle } : {}),
                      sourceSignalId: item.signalId,
                      sourceCreator: item.creator,
                      ...(item.url ? { sourceUrl: item.url } : {}),
                    })
                  }
                >
                  <Lightbulb size={13} /> Create idea
                </button>
                {item.url && (
                  <a className="ghost-button" href={item.url} target="_blank" rel="noreferrer" aria-label="Open source"><ArrowSquareOut size={13} /></a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
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

function FormatSection({ signal, threshold }: { signal: FormatSignal; threshold: number }) {
  return (
    <section className={signal.id === UNCLASSIFIED ? "format-section rest" : "format-section"}>
      <div className="format-head">
        <div><h2>{signal.label}</h2><p>{signal.hint}</p></div>
        <div className="facts">
          <span><strong>{signal.count}</strong> reels</span>
          <span><strong>{signal.averageOutlier.toFixed(1)}x</strong> avg outlier</span>
          <span><strong>{Math.round(signal.share * 100)}%</strong> of outliers</span>
        </div>
      </div>
      <div className="format-strip">
        {signal.examples.map((example, index) => (
          <article key={example.id}>
            <SignalMedia signal={example} index={index} threshold={threshold} />
            <h3>{example.title}</h3>
            <small>{formatNumber(example.plays ?? example.views)} plays · {example.outlier.toFixed(1)}x</small>
          </article>
        ))}
      </div>
      <div className="spark-row">
        <div className="spark"><span>Reels per week</span><Sparkline values={signal.weeks} lime /></div>
        <div className="spark"><span>Example outliers</span><Sparkline values={signal.examples.map((example) => example.outlier)} /></div>
      </div>
    </section>
  );
}

const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });

function formatMonth(iso: string) {
  return monthLabel.format(new Date(iso));
}

/** A delta reads as a delta: the sign is always there, zero included. */
function signed(value: number, digits = 0) {
  return `${value > 0 ? "+" : value < 0 ? "\u2212" : "\u00b1"}${Math.abs(value).toFixed(digits)}`;
}

/** Share deltas are points of the corpus, not percent of a percent. */
function signedPoints(value: number) {
  return `${signed(Math.round(value * 100))} pt`;
}

/** What each badge means, spelled out under the header so the move never lives in a tooltip alone. */
const MOVE_TITLE: Record<PatternMove, string> = {
  new: "Not in the previous review",
  up: "A larger slice of the outliers than last time",
  down: "A smaller slice of the outliers than last time",
  flat: "The share held inside one point",
  gone: "No outlier reel carried this shape in this window",
};

const MOVE_ORDER: PatternMove[] = ["new", "up", "down", "flat", "gone"];

function FormatReviewRow({ pattern }: { pattern: FormatReviewPattern }) {
  return (
    <li className={`review-row ${pattern.move}`}>
      <span className="review-move" title={MOVE_TITLE[pattern.move]}>{pattern.move}</span>
      <span className="review-label">{pattern.label}</span>
      <span className="review-fact">
        <strong>{Math.round(pattern.share * 100)}%</strong> of outliers <em>{signedPoints(pattern.shareDelta)}</em>
      </span>
      <span className="review-fact">
        <strong>{pattern.count}</strong> reels <em>{signed(pattern.countDelta)}</em>
      </span>
      <span className="review-fact">
        <strong>{pattern.averageOutlier.toFixed(1)}x</strong> avg <em>{signed(pattern.outlierDelta, 1)}</em>
      </span>
    </li>
  );
}

/**
 * "What changed": the monthly review the Convex cron writes on the first of the
 * month. The button runs the same computation now, which is how the file store
 * gets a review at all (ADR-0005).
 */
function FormatReviewPanel({ state, onRun }: { state: ReviewState; onRun: () => void }) {
  const { review, phase } = state;
  const running = phase === "running";

  return (
    <section className="review-panel">
      <div className="format-group-head">
        <h2>What changed</h2>
        <p>
          {review
            ? review.previousReviewId
              ? `Patterns of the trailing ${review.windowDays} days against the review of ${review.previousPeriodEnd?.slice(0, 10) ?? formatMonth(review.periodEnd)}. ${review.total} outlier reels, ${signed(review.total - review.previousTotal)} against last time.`
              : `The first review, ${formatMonth(review.periodEnd)}. ${review.total} outlier reels, nothing to compare against yet.`
            : "Recomputed on the first of every month over the trailing window, then diffed against the month before."}
        </p>
      </div>

      <div className="review-actions">
        <span>
          {phase === "loading" && "Loading the last review\u2026"}
          {phase === "error" && "The review could not be read."}
          {review && phase !== "loading" && `Last run ${review.generatedAt.slice(0, 10)}`}
          {!review && phase === "ready" && "No review yet."}
        </span>
        <button className="ghost-button" onClick={onRun} disabled={running}>
          {running ? "Running\u2026" : "Run review now"}
        </button>
      </div>

      {review && review.patterns.length > 0 && (
        <dl className="review-legend">
          {MOVE_ORDER.map((move) => (
            <Fragment key={move}>
              <dt className={`review-move ${move}`}>{move}</dt>
              <dd>{MOVE_TITLE[move]}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      {review && review.patterns.length > 0 && (
        <ol className="review-rows">
          {review.patterns.map((pattern) => (
            <FormatReviewRow key={pattern.id} pattern={pattern} />
          ))}
        </ol>
      )}

      {review && review.risingCreators.length > 0 && (
        <div className="review-rising">
          <h3>Small accounts to watch</h3>
          <p>
            The {FORMAT_REVIEW_RISING_LIMIT} strongest accounts under {formatNumber(FORMAT_REVIEW_SMALL_AUDIENCE)} followers whose outlier reel
            carries a named shape, one reel each. A shape that is new this month sorts first.
          </p>
          <ul>
            {review.risingCreators.map((entry) => (
              <li key={entry.creatorId}>
                <span className="handle">{entry.handle}</span>
                <span className="audience">{formatNumber(entry.audience)} followers</span>
                <span className={entry.patternMove === "new" ? "pattern new" : "pattern"}>{entry.patternLabel}</span>
                <span className="outlier">{entry.outlier.toFixed(1)}x</span>
                {entry.url ? (
                  <a className="signal-link" href={entry.url} target="_blank" rel="noreferrer">
                    {entry.title} <ArrowSquareOut size={12} />
                  </a>
                ) : (
                  <span className="title">{entry.title}</span>
                )}
                {entry.foreign && <span className="foreign">foreign niche</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FormatsView({
  rankedSignals,
  creators,
  threshold,
  review,
  onRunReview,
}: {
  rankedSignals: Ranked[];
  creators: Creator[];
  threshold: number;
  review: ReviewState;
  onRunReview: () => void;
}) {
  const { own, foreign } = useMemo(
    () => buildFormatSignals(rankedSignals, creators, { now: Date.now(), threshold }),
    [rankedSignals, creators, threshold],
  );
  const named = own.signals.filter((signal) => signal.id !== UNCLASSIFIED);
  const rest = own.signals.find((signal) => signal.id === UNCLASSIFIED);

  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Pattern desk / trailing {FORMAT_WINDOW_DAYS} days</p>
          <h1>Format Signals</h1>
          <p className="hero-sub">
            Recurring hook shapes read off the first caption line of every reel above {formatThreshold(threshold)} outlier.
            The list of shapes lives in lib/format-signals.ts; anything the rules miss is counted, not hidden.
          </p>
        </div>
        <div className="stat-blocks">
          <div><strong>{named.length}</strong><span>patterns found</span></div>
          <div><strong>{own.total}</strong><span>{formatThreshold(threshold)}+ outlier reels</span></div>
          <div className="lime"><strong>{rest ? Math.round(rest.share * 100) : 0}%</strong><span>unclassified</span></div>
        </div>
      </section>

      <FormatReviewPanel state={review} onRun={onRunReview} />

      {own.total === 0 && (
        <div className="empty-state">
          No reel above {formatThreshold(threshold)} outlier in the last {FORMAT_WINDOW_DAYS} days. Lower the threshold in Discover or refresh the watchlist.
        </div>
      )}

      {own.signals.map((signal) => (
        <FormatSection key={signal.id} signal={signal} threshold={threshold} />
      ))}

      {foreign.total > 0 && (
        <>
          <div className="format-group-head">
            <h2>Foreign niche</h2>
            <p>{foreign.total} outlier reels from creators marked as foreign niche. Kept apart so imported shapes never move the numbers above.</p>
          </div>
          {foreign.signals.map((signal) => (
            <FormatSection key={`foreign-${signal.id}`} signal={signal} threshold={threshold} />
          ))}
        </>
      )}
    </div>
  );
}

function ChannelsView({
  creators,
  rankedSignals,
  network,
  onNetwork,
  onAdd,
  onToggleForeign,
  onToggleOwned,
  issues,
}: {
  creators: Creator[];
  rankedSignals: Ranked[];
  network: Network;
  onNetwork: (network: Network) => void;
  onAdd: () => void;
  /** Flips the foreign-niche mark that splits the Format Signals tab. */
  onToggleForeign: (creator: Creator) => void;
  /** Flips the owned mark that moves a creator out of the research views into Profile. */
  onToggleOwned: (creator: Creator) => void;
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
                    <div><Link className="creator-link strong" href={creatorPath(creator.id, { from: "channels" })}>{creator.name}</Link><small>{creator.handle} · {creator.audience ? `${formatNumber(creator.audience)} ${network === "instagram" ? "followers" : "subs"}` : "Pending"}</small></div>
                  </div>
                </td>
                <td>
                  <span className="status-chip"><CheckCircle size={14} weight="fill" /> Watching · {creator.lastCheckedAt ? `checked ${timeAgo(creator.lastCheckedAt, nowMs)}` : "checked 8h ago"}</span>
                  {isOwned(creator) && <span className="niche-chip owned">Own account</span>}
                  {creator.foreign && <span className="niche-chip">Foreign niche</span>}
                </td>
                <td className="hide-sm"><span className="num">{own.length}</span> <span className="muted">videos · {formatNumber(median)} median</span></td>
                <td className="hide-sm"><span className="muted">{own[0]?.title ?? "No uploads retained yet"}</span></td>
                <td>
                  <div className="controls">
                    <button
                      className={isOwned(creator) ? "icon-button active" : "icon-button"}
                      onClick={() => onToggleOwned(creator)}
                      aria-pressed={isOwned(creator)}
                      title={isOwned(creator) ? "Own account: read in Profile, kept out of Discover, Briefing and Format Signals" : "Mark as my own account"}
                      aria-label="Toggle own account"
                    >
                      <UserCircle size={14} />
                    </button>
                    <button
                      className={creator.foreign ? "icon-button active" : "icon-button"}
                      onClick={() => onToggleForeign(creator)}
                      aria-pressed={Boolean(creator.foreign)}
                      title={creator.foreign ? "Foreign niche: their patterns stay in their own group" : "Mark as foreign niche"}
                      aria-label="Toggle foreign niche"
                    >
                      <Globe size={14} />
                    </button>
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

const statusCopy: Record<Idea["status"], string> = {
  captured: "Captured",
  developed: "Developed",
  produced: "Produced",
  dropped: "Dropped",
};

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** One stored idea with its storyboard folded away until it is wanted. */
function IdeaRow({
  idea,
  index,
  developing,
  blocked,
  onDevelop,
}: {
  idea: Idea;
  index: number;
  developing: boolean;
  blocked: boolean;
  onDevelop: (id: string) => void;
}) {
  const meta = [
    formatDay(idea.createdAt),
    idea.sourceCreator && `from ${idea.sourceCreator}`,
    idea.evidenceCount && `${idea.evidenceCount} reels as evidence`,
  ].filter(Boolean);
  const sourceLabel = idea.sourceCreator ? `Source reel ${idea.sourceCreator}` : "Source reel";

  return (
    <div className="idea-entry">
      <div className="idea-row">
        <span className="rank">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <small>{meta.join(" · ")}</small>
          <h3>{idea.title}</h3>
          {idea.goal && <p className="idea-goal">{idea.goal}</p>}
          {idea.sourceSignalId &&
            (idea.sourceUrl ? (
              <a className="signal-link" href={idea.sourceUrl} target="_blank" rel="noreferrer">
                {sourceLabel} <ArrowSquareOut size={11} />
              </a>
            ) : (
              <span className="signal-link">{sourceLabel}</span>
            ))}
        </div>
        <div className="idea-actions">
          <span className={`state status-${idea.status}`}>{statusCopy[idea.status]}</span>
          <button
            className="ghost-button"
            type="button"
            onClick={() => onDevelop(idea.id)}
            disabled={blocked || developing || idea.status === "dropped"}
          >
            {developing ? (
              <>
                <ArrowsClockwise className="spin" size={13} /> Developing
              </>
            ) : (
              <>
                <Sparkle size={13} /> {idea.storyboard ? "Develop again" : "Develop idea"}
              </>
            )}
          </button>
        </div>
      </div>
      {idea.storyboard && (
        <details className="storyboard">
          <summary>
            Storyboard <span>{idea.developedAt ? formatStamp(idea.developedAt) : ""}</span>
          </summary>
          <dl>
            <dt>Hook</dt>
            <dd>{idea.storyboard.hook}</dd>
            {idea.storyboard.beats.map((beat, position) => (
              <Fragment key={`${idea.id}-beat-${position}`}>
                <dt>Beat {position + 1} · {beat.label}</dt>
                <dd>{beat.detail}</dd>
              </Fragment>
            ))}
            <dt>CTA</dt>
            <dd>{idea.storyboard.cta}</dd>
            <dt>Caption</dt>
            <dd>{idea.storyboard.caption}</dd>
            <dt>Takeaway</dt>
            <dd>{idea.storyboard.takeaway}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}

function IdeasView({
  strategy,
  live,
  bridge,
  ideas,
  onGenerate,
  onRecheckBridge,
  onCapture,
  onDevelop,
  onReloadIdeas,
}: {
  strategy: StrategyState;
  live: boolean;
  bridge: BridgeHealth;
  ideas: IdeasState;
  onGenerate: (input: { idea: string; goal: string }) => void;
  onRecheckBridge: () => void;
  onCapture: (input: IdeaInput) => void;
  onDevelop: (id: string) => void;
  onReloadIdeas: () => void;
}) {
  const [idea, setIdea] = useState("");
  const [goal, setGoal] = useState("");
  const status = bridgeCopy[bridge];
  const { result, phase, error, evidence } = strategy;
  const blocked = bridge === "offline" || bridge === "logged-out" || phase === "loading";
  // The working title is what you typed; the generated angle only fills in for it.
  const captureTitle = idea.trim() || result?.angle || "";
  const developed = ideas.items.filter((item) => item.storyboard).length;

  function capture() {
    onCapture({ title: captureTitle, goal: goal.trim() });
    setIdea("");
    setGoal("");
  }

  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Idea repository / strategy desk</p>
          <h1>Ideas</h1>
          <p className="hero-sub">Capture a working idea, test how it reads as short form and long form, then develop it into a storyboard with the local strategy bridge.</p>
        </div>
        <div className="stat-blocks">
          <div><strong>{ideas.items.length}</strong><span>captured ideas</span></div>
          <div><strong>{evidence.length}</strong><span>outlier reels as evidence</span></div>
          <div className="lime"><strong>{developed}</strong><span>storyboards</span></div>
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
            <button className="secondary-button" type="button" onClick={capture} disabled={!captureTitle}>Capture idea</button>
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
            <div><button className="secondary-button" type="button" onClick={capture} disabled={!captureTitle}>Capture idea</button></div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="kicker">Idea repository</p>
            <h2>Captured ideas</h2>
            <p>Stored in the ideas table. Develop sends the idea and the evidence packet to the bridge.</p>
          </div>
          <button className="ghost-button" type="button" onClick={onReloadIdeas}>
            <ArrowsClockwise size={13} /> Reload
          </button>
        </div>
        {ideas.error && (
          <div className="strategy-error">
            <WarningCircle size={20} weight="fill" />
            <h3>The last idea action failed</h3>
            <p>{ideas.error}</p>
          </div>
        )}
        {ideas.phase === "loading" && <div className="empty-state">Reading the ideas table.</div>}
        {ideas.phase === "error" && <div className="empty-state">The ideas table is unreachable.</div>}
        {ideas.phase === "ready" && ideas.items.length === 0 && (
          <div className="empty-state">No idea captured yet. Capture one above, or from a card in Discover.</div>
        )}
        {ideas.items.map((item, index) => (
          <IdeaRow
            key={item.id}
            idea={item}
            index={index}
            developing={ideas.developing === item.id}
            blocked={blocked || (ideas.developing !== null && ideas.developing !== item.id)}
            onDevelop={onDevelop}
          />
        ))}
      </section>

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

/**
 * The Hooks board. Paste a transcript, an idea or one line, ask for 5, 10 or 15
 * first-three-second variants, and read them grouped by the hypothesis each one
 * tests. Every run is its own entry in the history rail.
 */
function HooksView({
  hooks,
  live,
  bridge,
  evidence,
  onGenerate,
  onRecheckBridge,
  onSelect,
  onReload,
}: {
  hooks: HooksState;
  live: boolean;
  bridge: BridgeHealth;
  evidence: StrategyEvidenceItem[];
  onGenerate: (input: { source: string; direction: string; count: number }) => void;
  onRecheckBridge: () => void;
  onSelect: (id: string) => void;
  onReload: () => void;
}) {
  const [source, setSource] = useState("");
  const [direction, setDirection] = useState("");
  const [count, setCount] = useState<number>(HOOK_COUNTS[1]);
  const status = bridgeCopy[bridge];
  const length = source.trim().length;
  const tooLong = length > HOOK_INPUT_MAX;
  // tooLong stays clickable on purpose: the refusal names the count, the disabled button would not.
  const blocked = bridge === "offline" || bridge === "logged-out" || length === 0;
  // The newest run is the board until one is picked out of the history rail.
  const shown = hooks.runs.find((run) => run.id === hooks.selected) ?? hooks.runs[0] ?? null;
  const variants = shown ? shown.groups.reduce((total, group) => total + group.variants.length, 0) : 0;

  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Hooks board / evidence backed</p>
          <h1>Hooks</h1>
          <p className="hero-sub">Paste the transcript, the idea, or the one line you have. The desk writes the first three seconds against the tracked outlier corpus and groups the variants by the hypothesis each one tests.</p>
        </div>
        <div className="stat-blocks">
          <div><strong>{hooks.runs.length}</strong><span>saved runs</span></div>
          <div><strong>{count}</strong><span>hooks per run</span></div>
          <div className="lime"><strong>{evidence.length}</strong><span>outlier reels as evidence</span></div>
        </div>
      </section>

      <div className="two-col">
        <section className="panel glow">
          <div className="panel-head">
            <div>
              <p className="kicker">Source material</p>
              <h2>What is this reel actually about</h2>
              <p>Longer input produces sharper hooks. A full transcript gives the desk the real proof and the real payoff to write against. Up to {formatNumber(HOOK_INPUT_MAX)} characters.</p>
            </div>
            <div className="control-cluster">
              <div><span>Model</span><select defaultValue="strategy"><option value="strategy">Sol · strategy</option></select></div>
              <div>
                <span>Hooks</span>
                <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                  {HOOK_COUNTS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
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
                <span>The cards show demo fixtures. The hooks run never sees them.</span>
              </>
            )}
          </div>

          <div className="panel-body">
            <div>
              <label htmlFor="hook-source">Transcript, idea, or one liner</label>
              <textarea id="hook-source" style={{ minHeight: 180 }} placeholder="Paste the full transcript here, or write the premise in a sentence." value={source} onChange={(event) => setSource(event.target.value)} />
              {/* Exact here, not abbreviated: this is the number the refusal counts against. */}
              <p className={tooLong ? "count over" : "count"}>
                {length} / {HOOK_INPUT_MAX} characters
                {tooLong && ` · ${length - HOOK_INPUT_MAX} too many`}
              </p>
            </div>
            <div>
              <label htmlFor="hook-direction">Direction · optional</label>
              <textarea id="hook-direction" placeholder="Angle it at agencies. Keep the tool name in the first three words." value={direction} onChange={(event) => setDirection(event.target.value)} />
            </div>
          </div>
          <div className="panel-foot">
            <span>Uses the local strategy bridge. Nothing is sent to an API key.</span>
            <button className="primary-button" type="button" onClick={() => onGenerate({ source, direction, count })} disabled={blocked}>
              Generate hooks <ArrowRight size={15} />
            </button>
          </div>

          {hooks.running > 0 && (
            <div className="strategy-loading">
              <span /><span /><span />
              <p>{hooks.running === 1 ? "Writing hooks against the evidence packet" : `${hooks.running} runs against the evidence packet`}</p>
            </div>
          )}
          {hooks.error && (
            <div className="strategy-error">
              <WarningCircle size={20} weight="fill" />
              <h3>No board</h3>
              <p>{hooks.error}</p>
            </div>
          )}

          {shown && (
            <div className="hook-board">
              <div className="hook-board-head">
                <span>{variants} hooks from {shown.evidenceCount} outlier reels</span>
                <span className="num">{formatStamp(shown.createdAt)}</span>
              </div>
              {shown.groups.map((group) => (
                <section className="hook-group" key={group.hypothesis}>
                  <header>
                    <h3>{group.label}</h3>
                    <p>{group.hint}</p>
                    <span className="num">{group.variants.length}</span>
                  </header>
                  {group.variants.map((variant, index) => (
                    <article className="hook-row" key={`${group.hypothesis}-${index}`}>
                      <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <h4>{variant.hook}</h4>
                        <p>{variant.rationale}</p>
                        <ul className="hook-evidence">
                          {variant.evidence.map((item) => (
                            <li key={`${item.creator}-${item.hook}`}>
                              <strong>{formatOutlier(item.outlier)}</strong> {item.creator} · {item.hook}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  ))}
                </section>
              ))}
            </div>
          )}
          {!shown && hooks.phase === "ready" && hooks.running === 0 && (
            <div className="empty-state">No run yet. Paste the source above and generate the first board.</div>
          )}
          {hooks.phase === "loading" && <div className="empty-state">Reading the hook runs.</div>}
          {hooks.phase === "error" && <div className="empty-state">The hookRuns table is unreachable.</div>}
        </section>

        <aside className="history-rail">
          <div className="rail-head">
            <span>History</span>
            <button className="ghost-button" type="button" onClick={onReload}>
              <ArrowsClockwise size={12} /> {hooks.runs.length} saved
            </button>
          </div>
          {hooks.runs.length === 0 && <div className="empty-state">Every run lands here.</div>}
          {hooks.runs.map((run) => (
            <article key={run.id} className={shown?.id === run.id ? "active" : undefined}>
              <button type="button" onClick={() => onSelect(run.id)}>
                <div className="when">
                  {formatStamp(run.createdAt)} · {run.kind === "transcript" ? "Transcript" : "One liner"}
                  <strong>{run.requested} hooks</strong>
                </div>
                <p>{run.sourceExcerpt}</p>
              </button>
              <span className="num">{formatNumber(run.sourceLength)}</span>
            </article>
          ))}
        </aside>
      </div>
    </div>
  );
}

/** Reach of one owned lane, off the same corpus math the creator detail reads. */
function laneStats(reels: Ranked[]) {
  const { retained, views, strongestOutlier } = creatorStats(reels);
  return {
    count: retained,
    averagePlays: retained ? Math.round(views / retained) : 0,
    bestOutlier: strongestOutlier,
  };
}

function ProfileView({ creators, rankedSignals, runs, runsState }: { creators: Creator[]; rankedSignals: Ranked[]; runs: Run[]; runsState: "loading" | "ready" | "error" }) {
  const owned = creators.filter(isOwned);
  const ownedIds = new Set(owned.map((c) => c.id));
  const nowMs = Date.now();
  // Outlier first: the question this tab answers is which own format last caught fire.
  const mine = rankedSignals
    .filter((s) => ownedIds.has(s.creatorId))
    .sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0) || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const followers = owned.reduce((sum, creator) => sum + creator.audience, 0);
  const all = laneStats(mine);
  /** Per lane, so two own accounts never read as one average. */
  const lanes = owned.map((creator) => ({ creator, ...laneStats(mine.filter((s) => s.creatorId === creator.id)) }));
  return (
    <div className="view-stack">
      <section className="hero">
        <div>
          <p className="hero-kicker">Owned performance / separate from research</p>
          <h1>Profile</h1>
          <p className="hero-sub">Your own lanes, tracked with the same outlier math as the competitor corpus. Find the last banger, then work out what made it one.</p>
        </div>
        <div className="stat-blocks">
          <div><strong>{formatNumber(followers)}</strong><span>followers</span></div>
          <div><strong>{all.count}</strong><span>videos tracked</span></div>
          <div><strong>{all.count ? formatNumber(all.averagePlays) : "—"}</strong><span>average plays</span></div>
          <div className="lime"><strong>{formatOutlier(all.bestOutlier)}</strong><span>strongest outlier</span></div>
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

      <div className="section-head"><div><p className="kicker">Own accounts</p><h2>Owned lanes</h2></div><p className="note">Followers, average plays and the strongest outlier per own account. Mark a handle as your own under Tracked Channels to add a lane.</p></div>
      <table className="desk-table">
        <thead><tr><th>Account</th><th className="right">Followers</th><th className="right">Reels</th><th className="right">Ø plays</th><th className="right">Best outlier</th></tr></thead>
        <tbody>
          {lanes.map(({ creator, count, averagePlays, bestOutlier }) => (
            <tr key={creator.id}>
              <td>
                <div className="creator-cell">
                  <span className="creator-avatar" style={{ background: creator.accent }}>
                    {creator.avatarUrl ? <img src={creator.avatarUrl} alt="" referrerPolicy="no-referrer" /> : creator.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div><strong>{creator.name}</strong><small>{creator.handle}</small></div>
                </div>
              </td>
              <td className="right num">{formatNumber(creator.audience)}</td>
              <td className="right num">{count}</td>
              <td className="right num">{count ? formatNumber(averagePlays) : "—"}</td>
              <td className="right lime">{formatOutlier(bestOutlier)}</td>
            </tr>
          ))}
          {lanes.length === 0 && <tr><td colSpan={5}><div className="empty-state">No own account marked yet.</div></td></tr>}
        </tbody>
      </table>

      <div className="section-head"><div><p className="kicker">Own performance</p><h2>Every owned upload, strongest first</h2></div><p className="note">The same follower-relative outlier the competitor corpus is read with, so the last own banger is the top row.</p></div>
      <table className="desk-table">
        <thead><tr><th>Video</th><th className="hide-sm">Published</th><th className="right">Plays</th><th className="right">Outlier</th></tr></thead>
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
              <td><strong>{formatStamp(run.startedAt)}</strong><br /><small className="muted">{run.kind}</small></td>
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
          <label className="check-label"><input type="checkbox" name="owned" /><span>This is my own account<small>Owned accounts are read in Profile and stay out of Discover, Briefing and Format Signals.</small></span></label>
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={state === "loading"}>{state === "loading" ? "Backfilling 90 days via Apify…" : state === "error" ? "Failed, retry" : "Add to daily watch"}<ArrowRight size={15} /></button></div>
        </form>
      </div>
    </div>
  );
}
