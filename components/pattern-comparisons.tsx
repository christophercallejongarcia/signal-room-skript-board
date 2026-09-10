"use client";

import { ArrowSquareOut, CheckCircle, Flask, WarningCircle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { Creator, PatternEvidence, SavePatternComparison, SignalRecord } from "@/lib/contracts";

export type PatternComparisonState = { items: SavePatternComparison[]; phase: "loading" | "ready" | "running" | "error"; error: string };

function ageBucket(signal: SignalRecord) {
  const days = Math.floor((Date.now() - Date.parse(signal.publishedAt)) / 86_400_000);
  return days <= 7 ? "0-7" : days <= 30 ? "8-30" : "31-90";
}

function EvidenceGroup({ title, ids, evidence, signals, creators, onOpen }: { title: string; ids: string[]; evidence: PatternEvidence[]; signals: SignalRecord[]; creators: Creator[]; onOpen: (id: string) => void }) {
  const rows = ids.flatMap((id) => {
    const item = evidence.find((candidate) => candidate.id === id);
    const signal = item ? signals.find((candidate) => candidate.id === item.signalId) : undefined;
    return item && signal ? [{ item, signal }] : [];
  });
  const handles = [...new Set(rows.map(({ signal }) => creators.find((creator) => creator.id === signal.creatorId)?.handle).filter(Boolean))];
  return <div className="pattern-sample"><h4>{title} <span>{rows.length}</span></h4>{handles.length > 0 && <p className="pattern-creators">{handles.join(" · ")}</p>}{rows.length === 0 ? <p className="pattern-empty">Keine geprüften Reels.</p> : <ul>{rows.map(({ item, signal }) => <li key={item.id}>
    <div><strong>{signal.title}</strong>{signal.url && <a href={signal.url} target="_blank" rel="noreferrer" aria-label="Reel öffnen"><ArrowSquareOut size={13} /></a>}</div>
    <small>{item.outlier?.toFixed(2)}x Outlier · {item.explanation}</small>
    {item.quote && <blockquote>„{item.quote}“</blockquote>}
    {item.verdict === "unknown" && <button className="ghost-button" onClick={() => onOpen(signal.id)}>Reel öffnen und transkribieren</button>}
  </li>)}</ul>}</div>;
}

export function PatternComparisons({ state, signals, creators, demo, onDiscover, onOpenReel }: {
  state: PatternComparisonState; signals: SignalRecord[]; creators: Creator[]; demo: SavePatternComparison[];
  onDiscover: (sourceSignalIds: string[], scope: { market: "de" | "en"; niche: "core" | "foreign"; topic: string; ageBucket: "0-7" | "8-30" | "31-90"; owned: boolean }) => void;
  onOpenReel: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const items = demo.length ? demo : state.items;
  const selectable = useMemo(() => signals.filter((signal) => signal.format === "reel" && signal.transcriptStatus === "ready" && signal.transcript?.trim()).slice(0, 30), [signals]);
  function start() {
    const first = signals.find((signal) => signal.id === selected[0]);
    const creator = first && creators.find((item) => item.id === first.creatorId);
    if (!first || !creator) return;
    onDiscover(selected, { market: creator.market ?? "de", niche: creator.foreign ? "foreign" : "core", topic: first.topic, ageBucket: ageBucket(first), owned: Boolean(creator.owned) });
  }
  return <section className="pattern-comparisons panel">
    <header className="panel-head"><div><p className="kicker">Full transcript patterns</p><h2>Geprüfte Pattern-Kandidaten</h2><p>Wähle vollständige Reels als Ausgangspunkt. Der lokale Bridge formuliert eine Hypothese und prüft dieselbe Definition danach ausdrücklich auf Vorhandensein oder Abwesenheit.</p></div><Flask size={24} /></header>
    <div className="pattern-discovery-controls">
      <div className="pattern-source-list" aria-label="Ausgangs-Reels">{selectable.map((signal) => <label key={signal.id}><input type="checkbox" checked={selected.includes(signal.id)} onChange={() => setSelected((current) => current.includes(signal.id) ? current.filter((id) => id !== signal.id) : current.length < 10 ? [...current, signal.id] : current)} /> <span>{signal.title}</span></label>)}</div>
      <button className="primary-button" disabled={selected.length === 0 || state.phase === "running" || demo.length > 0} onClick={start}>{state.phase === "running" ? "Definition wird geprüft…" : "Pattern entdecken und prüfen"}</button>
      {demo.length > 0 && <small>Synthetische Demo. Ein gespeicherter Store startet den echten lokalen Lauf.</small>}
      {state.error && <p className="error-note">{state.error}</p>}
    </div>
    {state.phase === "loading" && demo.length === 0 && <div className="empty-state">Pattern-Vergleiche werden geladen…</div>}
    {state.phase === "error" && items.length === 0 && <div className="empty-state">Pattern-Vergleiche konnten nicht geladen werden.</div>}
    {state.phase === "ready" && items.length === 0 && <div className="empty-state">Noch kein Vergleich gespeichert. Wähle vollständige, bereits analysierte Reels als Ausgangspunkt.</div>}
    <div className="pattern-comparison-list">{items.map(({ pattern, run, evidence }) => <article key={run.id} className="pattern-comparison-card">
      <header><div><span className={`status-chip ${run.status === "candidate" ? "run-ok" : "run-partial"}`}>{run.status === "candidate" ? <CheckCircle size={14} /> : <WarningCircle size={14} />}{run.status === "candidate" ? "Kandidat" : run.status === "non-positive" ? "Keine positive Differenz" : "Unzureichend belegt"}</span><h3>{pattern.name}</h3><p>{pattern.definition}</p></div><dl><div><dt>Mit Pattern</dt><dd>{run.positiveMedian?.toFixed(2) ?? "unbekannt"}x</dd></div><div><dt>Ohne Pattern</dt><dd>{run.negativeMedian?.toFixed(2) ?? "unbekannt"}x</dd></div><div><dt>Differenz</dt><dd>{run.medianDelta === undefined ? "unbekannt" : `${run.medianDelta > 0 ? "+" : ""}${run.medianDelta.toFixed(2)}x`}</dd></div></dl></header>
      <p className="pattern-scope">{run.scope.market.toUpperCase()} · {run.scope.niche === "core" ? "Kernnische" : "Fremdnische"} · {run.scope.topic} · {run.scope.ageBucket} Tage · {run.scope.owned ? "Owned" : "Research"} · 90-Tage-Fenster · erfasst {new Date(run.createdAt).toLocaleString()}</p>
      <div className="pattern-samples"><EvidenceGroup title={`Vorhanden · ${run.positiveCount}/${run.thresholds.positiveReels} Reels · ${run.positiveCreatorCount}/${run.thresholds.positiveCreators} Creator`} ids={run.positiveEvidenceIds} evidence={evidence} signals={signals} creators={creators} onOpen={onOpenReel} /><EvidenceGroup title={`Abwesend · ${run.negativeCount}/${run.thresholds.negativeReels} Reels`} ids={run.negativeEvidenceIds} evidence={evidence} signals={signals} creators={creators} onOpen={onOpenReel} /><EvidenceGroup title={`Unbekannt · ${run.unknownCount}`} ids={run.unknownEvidenceIds} evidence={evidence} signals={signals} creators={creators} onOpen={onOpenReel} /></div>
      <footer><span>Ausgeschlossen: {Object.entries(run.excluded).filter(([, count]) => count > 0).map(([reason, count]) => `${reason} ${count}`).join(" · ") || "keine"}</span><strong>{run.caution}</strong></footer>
    </article>)}</div>
  </section>;
}
