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
} from "@phosphor-icons/react";
import { FormEvent, useMemo, useState } from "react";
import { demoCreators, demoIdeas, demoSignals } from "@/lib/demo-data";
import { DEMO_SCORING_NOTE, demoScorer } from "@/lib/demo-score";
import type { Creator, Network, StrategyResponse } from "@/lib/contracts";

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
  return <span className="network-label">{network}</span>;
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
  const [creators, setCreators] = useState<Creator[]>(demoCreators);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("Demo snapshot");
  const [showAddCreator, setShowAddCreator] = useState(false);
  const [strategy, setStrategy] = useState<StrategyResponse | null>(null);
  const [strategyState, setStrategyState] = useState<"idle" | "loading" | "error">("idle");

  const rankedSignals = useMemo(
    () => demoScorer.rank(demoSignals, creators, new Date("2026-08-22T16:00:00.000Z")),
    [creators],
  );

  const activeNav = navItems.find((item) => item.id === activeTab) ?? navItems[0];
  const ActiveIcon = activeNav.icon;

  async function refreshDemo() {
    if (refreshing) return;
    setRefreshing(true);
    await new Promise((resolve) => window.setTimeout(resolve, 850));
    setLastRefresh("Refreshed just now");
    setRefreshing(false);
  }

  function addCreator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const handle = String(form.get("handle") || "").trim().replace(/^@/, "");
    const network = String(form.get("network") || "youtube") as Network;
    if (!handle) return;

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

  async function generateStrategy() {
    setStrategyState("loading");
    setStrategy(null);

    try {
      const endpoint = process.env.NEXT_PUBLIC_STRATEGY_BRIDGE_URL || "http://127.0.0.1:3211";
      const response = await fetch(`${endpoint}/v1/strategy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: "Turn the strongest current signal into a useful evidence-led creator story.",
          audience: "Builders and small teams adopting practical AI workflows.",
          evidence: rankedSignals.slice(0, 3).map(({ title, topic, score }) => ({ title, topic, score })),
        }),
      });

      if (!response.ok) throw new Error("The local bridge is unavailable.");
      setStrategy((await response.json()) as StrategyResponse);
      setStrategyState("idle");
    } catch {
      setStrategyState("error");
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setActiveTab("discover")} aria-label="Open Discover">
          <span className="brand-mark">SR</span>
          <span>
            <strong>Signal Room</strong>
            <small>Starter workspace</small>
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
                <Icon size={17} weight={activeTab === item.id ? "fill" : "regular"} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="topbar-actions">
          <span className="demo-badge">Synthetic data</span>
          <button className="icon-button" onClick={() => setActiveTab("profile")} aria-label="Open profile">
            <UserCircle size={22} />
          </button>
        </div>
      </header>

      <main>
        <section className="page-heading">
          <div>
            <span className="section-icon" aria-hidden="true">
              <ActiveIcon size={20} weight="fill" />
            </span>
            <div>
              <p className="page-kicker">Creator intelligence workspace</p>
              <h1>{activeNav.label}</h1>
            </div>
          </div>
          <div className="heading-actions">
            <span className="refresh-note">
              <Clock size={15} /> {lastRefresh}
            </span>
            <button className="secondary-button" onClick={refreshDemo} disabled={refreshing}>
              <ArrowsClockwise className={refreshing ? "spin" : ""} size={17} />
              {refreshing ? "Refreshing" : "Refresh demo"}
            </button>
          </div>
        </section>

        {activeTab === "discover" && <DiscoverView rankedSignals={rankedSignals} creators={creators} />}
        {activeTab === "briefing" && <BriefingView rankedSignals={rankedSignals} />}
        {activeTab === "radar" && <RadarView rankedSignals={rankedSignals} />}
        {activeTab === "formats" && <FormatsView />}
        {activeTab === "channels" && (
          <ChannelsView creators={creators} onAdd={() => setShowAddCreator(true)} />
        )}
        {activeTab === "ideas" && (
          <IdeasView
            strategy={strategy}
            strategyState={strategyState}
            onGenerate={generateStrategy}
          />
        )}
        {activeTab === "thumbnails" && <ThumbnailsView />}
        {activeTab === "titles" && <TitlesView />}
        {activeTab === "profile" && <ProfileView creators={creators} />}
      </main>

      {showAddCreator && <AddCreatorDialog onClose={() => setShowAddCreator(false)} onSubmit={addCreator} />}
    </div>
  );
}

function DiscoverView({
  rankedSignals,
  creators,
}: {
  rankedSignals: ReturnType<typeof demoScorer.rank>;
  creators: Creator[];
}) {
  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));

  return (
    <div className="view-stack">
      <section className="metrics-strip" aria-label="Demo summary">
        <div><strong>{rankedSignals.length}</strong><span>signals ranked</span></div>
        <div><strong>{creators.length}</strong><span>channels tracked</span></div>
        <div><strong>{new Set(rankedSignals.map((item) => item.topic)).size}</strong><span>topics moving</span></div>
        <div className="metric-note"><Sparkle size={19} weight="fill" /><span>Transparent demo ranker</span></div>
      </section>

      <div className="signal-grid">
        {rankedSignals.map((signal, index) => {
          const creator = creatorMap.get(signal.creatorId);
          if (!creator) return null;
          return (
            <article className={index === 0 ? "signal-card featured" : "signal-card"} key={signal.id}>
              <SignalArtwork seed={signal.thumbnailSeed} topic={signal.topic} index={index} />
              <div className="signal-content">
                <div className="signal-meta">
                  <NetworkLabel network={creator.network} />
                  <span>{creator.handle}</span>
                </div>
                <h2>{signal.title}</h2>
                <p>{signal.reason}</p>
                <div className="signal-stats">
                  <span><strong>{signal.score}</strong> signal score</span>
                  <span><strong>{signal.relativeReach}x</strong> relative reach</span>
                  <span><strong>{formatNumber(signal.views)}</strong> views</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <aside className="explain-note">
        <WarningCircle size={22} weight="fill" />
        <div><strong>Designed for replacement</strong><p>{DEMO_SCORING_NOTE}</p></div>
      </aside>
    </div>
  );
}

function BriefingView({ rankedSignals }: { rankedSignals: ReturnType<typeof demoScorer.rank> }) {
  return (
    <div className="briefing-layout">
      <article className="editorial-brief">
        <p className="brief-date">Friday briefing</p>
        <h2>Agent workflows are moving from demos to operating systems.</h2>
        <p className="brief-intro">
          The strongest synthetic signals cluster around inspectable memory, evidence, and small-team operations.
        </p>
        <div className="brief-body">
          <h3>What changed</h3>
          <p>Creators are spending less time on isolated prompts and more time showing the infrastructure around repeatable work.</p>
          <h3>Why it matters</h3>
          <p>The opportunity is not another tool roundup. It is a useful explanation of what makes an AI workflow trustworthy enough to run every day.</p>
          <h3>Editorial lead</h3>
          <p>Trace one workflow from incoming evidence to a decision, then show the receipts at every handoff.</p>
        </div>
      </article>
      <aside className="evidence-rail">
        <h3>Evidence used</h3>
        {rankedSignals.slice(0, 4).map((signal, index) => (
          <div className="evidence-item" key={signal.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{signal.title}</strong><small>{signal.score} score, {signal.topic}</small></div>
          </div>
        ))}
      </aside>
    </div>
  );
}

function RadarView({ rankedSignals }: { rankedSignals: ReturnType<typeof demoScorer.rank> }) {
  const topics = Array.from(new Set(rankedSignals.map((signal) => signal.topic))).map((topic) => {
    const signals = rankedSignals.filter((signal) => signal.topic === topic);
    return {
      topic,
      count: signals.length,
      momentum: Math.round(signals.reduce((sum, signal) => sum + signal.score, 0) / signals.length),
      lead: signals[0].title,
    };
  });

  return (
    <section className="radar-board">
      <div className="radar-plot" aria-label="Topic momentum plot">
        <div className="radar-axis axis-x" /><div className="radar-axis axis-y" />
        {topics.map((topic, index) => (
          <button
            className={`radar-node node-${index}`}
            key={topic.topic}
            style={{ "--node-size": `${Math.max(72, topic.momentum * 1.25)}px` } as React.CSSProperties}
          >
            <strong>{topic.momentum}</strong><span>{topic.topic}</span>
          </button>
        ))}
        <span className="axis-label x-label">More momentum</span>
        <span className="axis-label y-label">More evidence</span>
      </div>
      <div className="radar-list">
        <h2>Topics worth opening</h2>
        {topics.map((topic) => (
          <article key={topic.topic}>
            <span className="topic-rank">{topic.momentum}</span>
            <div><h3>{topic.topic}</h3><p>{topic.lead}</p></div>
            <ArrowRight size={19} />
          </article>
        ))}
      </div>
    </section>
  );
}

function FormatsView() {
  const formats = [
    ["Evidence-led teardown", "Open with the outcome, then reveal the system and the proof behind it.", "High save intent"],
    ["Build in public", "Show the decisions, constraints, and one surprising failure from a real implementation.", "High trust"],
    ["Contrarian explainer", "Name a popular assumption, test it against evidence, then offer a practical replacement.", "High discussion"],
    ["Operating field guide", "Package a repeatable workflow into a sequence someone can run this week.", "High utility"],
  ];
  return (
    <div className="format-grid">
      {formats.map(([title, description, strength], index) => (
        <article className={`format-card format-${index}`} key={title}>
          <Shapes size={25} weight="duotone" />
          <div><h2>{title}</h2><p>{description}</p></div>
          <span>{strength}</span>
        </article>
      ))}
    </div>
  );
}

function ChannelsView({ creators, onAdd }: { creators: Creator[]; onAdd: () => void }) {
  return (
    <div className="channels-layout">
      <section className="channels-list">
        <div className="list-heading"><h2>Daily watch</h2><button className="primary-button" onClick={onAdd}><Plus size={17} />Add channel</button></div>
        {creators.map((creator) => (
          <article className="channel-row" key={creator.id}>
            <span className="creator-avatar" style={{ background: creator.accent }}>{creator.name.slice(0, 2).toUpperCase()}</span>
            <div><h3>{creator.name}</h3><p>{creator.handle}</p></div>
            <NetworkLabel network={creator.network} />
            <span className="audience-count">{creator.audience ? formatNumber(creator.audience) : "Pending"}</span>
            <span className="watch-state"><CheckCircle size={17} weight="fill" />Watched daily</span>
          </article>
        ))}
      </section>
      <aside className="pipeline-card">
        <h2>What happens after Add</h2>
        <ol>
          <li><span>1</span><div><strong>Validate</strong><p>The connector checks the network and resolves a canonical channel ID.</p></div></li>
          <li><span>2</span><div><strong>Collect</strong><p>A scheduled job requests recent public records from your chosen provider.</p></div></li>
          <li><span>3</span><div><strong>Normalize</strong><p>Provider fields become the shared SignalRecord contract.</p></div></li>
          <li><span>4</span><div><strong>Rank</strong><p>Your SignalScorer decides what deserves attention.</p></div></li>
        </ol>
      </aside>
    </div>
  );
}

function IdeasView({
  strategy,
  strategyState,
  onGenerate,
}: {
  strategy: StrategyResponse | null;
  strategyState: "idle" | "loading" | "error";
  onGenerate: () => void;
}) {
  return (
    <div className="ideas-layout">
      <section className="idea-board">
        {demoIdeas.map((idea) => (
          <article className="idea-row" key={idea.id}>
            <Lightbulb size={22} weight="duotone" />
            <div><h2>{idea.title}</h2><p>{idea.format}</p></div>
            <span>{idea.evidence} sources</span>
            <strong>{idea.state}</strong>
          </article>
        ))}
      </section>
      <aside className="strategy-panel">
        <div className="strategy-heading"><Sparkle size={24} weight="fill" /><div><h2>Strategy bridge</h2><p>Optional local Codex process</p></div></div>
        {!strategy && strategyState === "idle" && (
          <div className="strategy-empty"><p>Send the top synthetic signals to a constrained local strategy prompt.</p><button className="primary-button" onClick={onGenerate}>Generate angle<ArrowRight size={17} /></button></div>
        )}
        {strategyState === "loading" && <div className="strategy-loading"><span /><span /><span /><p>Codex is reading the evidence packet</p></div>}
        {strategyState === "error" && (
          <div className="strategy-error"><WarningCircle size={23} weight="fill" /><h3>Bridge is offline</h3><p>Run <code>npm run bridge</code> locally, then try again.</p><button className="secondary-button" onClick={onGenerate}>Try again</button></div>
        )}
        {strategy && (
          <div className="strategy-result"><span>Suggested angle</span><h3>{strategy.angle}</h3><p>{strategy.rationale}</p><dl><dt>Opening</dt><dd>{strategy.opening}</dd><dt>Proof to show</dt><dd>{strategy.proofToShow.join(", ")}</dd></dl></div>
        )}
      </aside>
    </div>
  );
}

function ThumbnailsView() {
  return (
    <div className="thumbnail-lab">
      <section className="thumbnail-stage">
        <SignalArtwork seed="plain-text-memory" topic="agent workflows" index={3} />
        <div className="thumbnail-copy"><span>Working direction</span><h2>Show the memory, not the magic.</h2><p>One idea, one object, one point of contrast.</p></div>
      </section>
      <aside className="thumbnail-variants">
        <h2>Visual variables</h2>
        {["One inspectable object", "High figure-ground contrast", "Four words or fewer", "No interface collage"].map((item, index) => (
          <div key={item}><span>{index + 1}</span><p>{item}</p><CheckCircle size={18} weight="fill" /></div>
        ))}
      </aside>
    </div>
  );
}

function TitlesView() {
  const titles = [
    ["I Let an Agent Run the Workflow", "Curiosity"],
    ["The Memory Layer You Can Actually Inspect", "Clarity"],
    ["Stop Hiding the Receipts", "Contrarian"],
    ["A Small-Team AI System That Survives Monday", "Utility"],
  ];
  return (
    <section className="titles-workbench">
      <div className="title-source"><span>Source idea</span><h2>Inspectable infrastructure makes AI workflows trustworthy.</h2></div>
      <div className="title-list">
        {titles.map(([title, intent], index) => (
          <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><small>{intent}</small><button aria-label={`Open ${title}`}><ArrowRight size={18} /></button></article>
        ))}
      </div>
    </section>
  );
}

function ProfileView({ creators }: { creators: Creator[] }) {
  return (
    <div className="profile-layout">
      <section className="profile-card"><span className="profile-mark">SR</span><div><h2>Your signal room</h2><p>A clean shell with replaceable intelligence.</p></div><span className="demo-badge">Demo mode</span></section>
      <section className="settings-panel">
        <h2>Workspace status</h2>
        <div><span>Data source</span><strong>Synthetic connector</strong></div>
        <div><span>Ranking method</span><strong>Transparent demo scorer</strong></div>
        <div><span>Tracked channels</span><strong>{creators.length}</strong></div>
        <div><span>Strategy bridge</span><strong>Local and optional</strong></div>
      </section>
      <aside className="private-boundary"><WarningCircle size={24} weight="fill" /><h2>Bring your own advantage</h2><p>Private prompts, source lists, thresholds, audience theory, and scoring logic belong in your own adapters and private environment.</p></aside>
    </div>
  );
}

function AddCreatorDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading"><div><p>Add to daily watch</p><h2 id="dialog-title">Track a public channel</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
        <form onSubmit={onSubmit}>
          <label><span>Channel handle</span><input name="handle" placeholder="@usefulcreator" autoFocus required /><small>The demo stores this only in browser memory.</small></label>
          <label><span>Network</span><select name="network" defaultValue="youtube"><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select></label>
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Add channel<ArrowRight size={17} /></button></div>
        </form>
      </div>
    </div>
  );
}
