"use client";

import { ArrowLeft, ArrowRight, ArrowSquareOut, ArrowsClockwise, CheckCircle, FileText, LockKey, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { tabPath } from "@/lib/creator-detail";
import { addCustomHookOption, canTransition, claimScriptRun, editHookOption, moveScript, patchScript, renderScriptReadingView, settleScriptRun, updateScriptSection } from "@/lib/scripts";
import { demoScriptDraftSections } from "@/lib/script-draft";
import { applyScriptLintSuggestion, scriptSectionId } from "@/lib/script-lint";
import type { Forecast, Script, ScriptFramework, ScriptLintSuggestion, ScriptPatch, ScriptSection, ScriptStatus, Storyboard } from "@/lib/contracts";

type Phase = "loading" | "ready" | "error";
type LinkedSignal = { id: string; title: string; url?: string };
type ScriptPayload = {
  script: Script;
  demo?: boolean;
  ideaTitle: string;
  storyboard?: Storyboard;
  forecast?: Forecast;
  sourceSignal: LinkedSignal | null;
  evidenceSignals: LinkedSignal[];
  evidenceCandidates: Array<LinkedSignal & { creator?: string; outlier?: number; plays?: number }>;
};

const statusCopy: Record<ScriptStatus, string> = {
  "hook-selection": "Hook Selection",
  draft: "Draft",
  review: "Review",
  approved: "Approved",
};

const frameworkCopy: Record<ScriptFramework, string> = {
  pas: "PAS",
  bbb: "BBB",
  none: "No framework",
};

export function ScriptDetail({ scriptId }: { scriptId: string }) {
  const [payload, setPayload] = useState<ScriptPayload | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [moving, setMoving] = useState<ScriptStatus | null>(null);
  const [sections, setSections] = useState<ScriptSection[]>([]);
  const [framework, setFramework] = useState<ScriptFramework>("none");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  const [linting, setLinting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [storyboarding, setStoryboarding] = useState(false);
  const [lintSuggestions, setLintSuggestions] = useState<ScriptLintSuggestion[]>([]);
  const [lintChecked, setLintChecked] = useState(false);
  const [editingOption, setEditingOption] = useState<string | null>(null);
  const [editHook, setEditHook] = useState("");
  const [editAngle, setEditAngle] = useState("");
  const [customHook, setCustomHook] = useState("");
  const [customAngle, setCustomAngle] = useState("");

  async function load() {
    setPhase("loading");
    try {
      const response = await fetch(`/api/scripts/${encodeURIComponent(scriptId)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as Partial<ScriptPayload> & { error?: string };
      if (!response.ok || !data.script || !data.ideaTitle || !("sourceSignal" in data) || !Array.isArray(data.evidenceSignals) || !Array.isArray(data.evidenceCandidates)) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setPayload(data as ScriptPayload);
      setPhase("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Script could not be loaded.");
      setPhase("error");
    }
  }

  useEffect(() => {
    void load();
  }, [scriptId]);

  const script = payload?.script;
  useEffect(() => {
    if (!script) return;
    setSections(script.sections);
    setFramework(script.framework);
    setDirty(false);
    setSavedNotice("");
  }, [script?.id, script?.revision, script?.updatedAt, script?.status, script?.framework]);

  useEffect(() => {
    setLintSuggestions([]);
    setLintChecked(false);
  }, [script?.id, script?.revision]);

  const readingView = useMemo(() => renderScriptReadingView(sections), [sections]);
  const editorLocked = !script || script.status === "approved" || Boolean(script.runId) || linting || drafting || storyboarding;
  const statusLocked = !script || Boolean(script.runId) || linting || drafting || storyboarding || dirty || Boolean(moving) || saving;

  function editSection(sectionIndex: number, values: Partial<Pick<ScriptSection, "label" | "text">>) {
    if (editorLocked) return;
    setSections((current) => updateScriptSection(current, sectionIndex, values));
    setDirty(true);
    setSavedNotice("");
    setError("");
  }

  function editFramework(value: ScriptFramework) {
    if (editorLocked) return;
    setFramework(value);
    setDirty(value !== script?.framework || JSON.stringify(sections) !== JSON.stringify(script?.sections));
    setSavedNotice("");
    setError("");
  }

  async function saveEditor() {
    if (!payload || !script || editorLocked || !dirty || saving) return;
    const editorPatch: ScriptPatch = { framework, ...(sections.length > 0 ? { sections } : {}) };
    setSaving(true);
    setError("");
    setSavedNotice("");
    try {
      const now = new Date().toISOString();
      const updated = payload.demo
        ? patchScript(script, editorPatch, now)
        : await patchStoredScript(script.id, editorPatch);
      setPayload({ ...payload, script: updated });
      setSavedNotice("Saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Script could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function runLint() {
    if (!payload || !script || editorLocked || dirty || linting || sections.length === 0) return;
    setLinting(true);
    setLintChecked(false);
    setLintSuggestions([]);
    setError("");
    try {
      const response = await fetch(`/api/scripts/${encodeURIComponent(script.id)}/lint`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { script?: Script; suggestions?: ScriptLintSuggestion[]; error?: string };
      if (!response.ok || !data.script || !Array.isArray(data.suggestions)) throw new Error(data.error || `HTTP ${response.status}`);
      setPayload({ ...payload, script: data.script });
      setLintSuggestions(data.suggestions);
      setLintChecked(true);
      setSavedNotice(data.suggestions.length > 0 ? `${data.suggestions.length} Vorschläge` : "Keine Slop-Stellen gefunden");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Lektorat run failed.");
    } finally {
      setLinting(false);
    }
  }

  async function runDraft() {
    if (!payload || !script || drafting || linting || saving || dirty || !script.selectedHookId) return;
    setDrafting(true);
    setError("");
    setSavedNotice("");
    try {
      let updated: Script;
      if (payload.demo) {
        const selected = script.hookOptions.find((option) => option.id === script.selectedHookId);
        if (!selected) throw new Error(`Unknown hook option ${script.selectedHookId}.`);
        const now = new Date().toISOString();
        const runId = `demo-script-draft-${script.revision + 1}`;
        const claimed = claimScriptRun(script, runId, now, { rejectIfRunning: true });
        const settled = settleScriptRun(claimed, runId, {
          now,
          status: "draft",
          framework,
          selectedHookId: selected.id,
          sections: demoScriptDraftSections(selected.hook),
        });
        if (!settled) throw new Error("The Demo Draft run became stale.");
        updated = settled;
      } else {
        const response = await fetch(`/api/scripts/${encodeURIComponent(script.id)}/draft`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ selectedHookId: script.selectedHookId, framework }),
        });
        const data = (await response.json().catch(() => ({}))) as { script?: Script; error?: string };
        if (!response.ok || !data.script) throw new Error(data.error || `HTTP ${response.status}`);
        updated = data.script;
      }
      setPayload({ ...payload, script: updated });
      setSavedNotice(script.status === "draft" ? "Draft ersetzt" : "Draft erstellt");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Draft run failed.");
    } finally {
      setDrafting(false);
    }
  }

  async function acceptLintSuggestion(suggestion: ScriptLintSuggestion) {
    if (!payload || !script || saving || linting || editorLocked) return;
    setSaving(true);
    setError("");
    try {
      const updated = applyScriptLintSuggestion(script, suggestion, new Date().toISOString());
      const persisted = payload.demo
        ? updated
        : await patchStoredScript(script.id, { sections: updated.sections });
      setPayload({ ...payload, script: persisted });
      setLintSuggestions((current) => current.filter((candidate) => candidate.sectionId !== suggestion.sectionId || candidate.original !== suggestion.original));
      setSavedNotice("Vorschlag übernommen");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Lektorat suggestion could not be applied.");
    } finally {
      setSaving(false);
    }
  }

  async function move(status: ScriptStatus) {
    if (!payload || !script || statusLocked || !canTransition(script.status, status)) return;
    setMoving(status);
    setError("");
    try {
      const now = new Date().toISOString();
      const updated = payload.demo
        ? moveScript(script, status, now)
        : await patchStoredScript(script.id, { status });
      setPayload({ ...payload, script: updated });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The status change failed.");
    } finally {
      setMoving(null);
    }
  }

  async function runStoryboard() {
    if (!payload || !script || script.status !== "approved" || storyboarding) return;
    setStoryboarding(true);
    setError("");
    try {
      const response = await fetch(`/api/scripts/${encodeURIComponent(script.id)}/storyboard`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { storyboard?: Storyboard; forecast?: Forecast; error?: string };
      if (!response.ok || !data.storyboard) throw new Error(data.error || `HTTP ${response.status}`);
      setPayload({ ...payload, storyboard: data.storyboard, forecast: data.forecast });
      setSavedNotice(payload.storyboard ? "Storyboard neu erzeugt" : "Storyboard erstellt");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Storyboard run failed.");
    } finally {
      setStoryboarding(false);
    }
  }

  async function saveHookPatch(patch: Parameters<typeof patchScript>[1]) {
    if (!payload || saving || script?.status === "approved") return;
    setSaving(true);
    setError("");
    try {
      const now = new Date().toISOString();
      const updated = payload.demo
        ? patchScript(payload.script, patch, now)
        : await patchStoredScript(payload.script.id, patch);
      setPayload({ ...payload, script: updated });
      setSavedNotice("Saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Hook change failed.");
    } finally {
      setSaving(false);
    }
  }

  function startEditing(option: Script["hookOptions"][number]) {
    setEditingOption(option.id);
    setEditHook(option.hook);
    setEditAngle(option.angle);
  }

  async function saveOption(optionId: string) {
    if (!payload) return;
    const updated = editHookOption(payload.script, optionId, { hook: editHook, angle: editAngle }, new Date().toISOString());
    await saveHookPatch({ hookOptions: updated.hookOptions, selectedHookId: updated.selectedHookId });
    setEditingOption(null);
  }

  async function addOwnHook() {
    if (!payload) return;
    const updated = addCustomHookOption(payload.script, { hook: customHook, angle: customAngle }, new Date().toISOString());
    await saveHookPatch({ hookOptions: updated.hookOptions, selectedHookId: updated.selectedHookId });
    setCustomHook("");
    setCustomAngle("");
  }

  async function changeEvidence(id: string, add: boolean) {
    if (!payload) return;
    const evidenceSignalIds = add
      ? [...payload.script.evidenceSignalIds, id]
      : payload.script.evidenceSignalIds.filter((candidate) => candidate !== id);
    await saveHookPatch({ evidenceSignalIds });
  }

  return (
    <div className="app-shell">
      <header className="topbar detail-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark"><FileText size={25} weight="bold" /></span>
          <span><strong>Signal Room</strong><small>Intelligence desk</small></span>
        </Link>
        <Link className="back-link" href={tabPath("scripts")}><ArrowLeft size={14} weight="bold" /> Back to Scripts</Link>
      </header>

      <main>
        {phase === "loading" && <div className="empty-state">Loading the Script…</div>}
        {phase === "error" && <div className="empty-state">The Script could not be loaded. {error}</div>}
        {phase === "ready" && script && payload && (
          <div className="view-stack">
            <section className="hero script-detail-hero">
              <div>
                <p className="hero-kicker">Script project / {statusCopy[script.status]}</p>
                <h1>{payload.ideaTitle}</h1>
                <div className="script-detail-source">
                  <span>Source Reel</span>
                  {payload.sourceSignal?.url ? <a className="signal-link" href={payload.sourceSignal.url} target="_blank" rel="noreferrer">{payload.sourceSignal.title} <ArrowSquareOut size={11} /></a> : <span className="muted">{payload.sourceSignal?.title ?? "No source Reel. This run uses the evidence packet only."}</span>}
                </div>
              </div>
              <div className="script-detail-facts">
                <span className={`state status-${script.status}`}>{statusCopy[script.status]}</span>
                <strong>Rev. {script.revision}</strong>
                <span>{frameworkCopy[framework]}</span>
              </div>
            </section>

            <section className="panel script-meta-panel">
              <div className="script-meta-grid">
                <div><span>Status</span><strong>{statusCopy[script.status]}</strong><small>{statusHint(script.status)}</small></div>
                <div><span>Revision</span><strong>{script.revision}</strong><small>{script.approvedRevision ? `Approved at Rev. ${script.approvedRevision}` : "No approval yet"}</small></div>
                <div>
                  <label className="script-framework-field" htmlFor="script-framework"><span>Framework</span><select id="script-framework" value={framework} disabled={editorLocked || saving} onChange={(event) => editFramework(event.target.value as ScriptFramework)}>{(Object.keys(frameworkCopy) as ScriptFramework[]).map((value) => <option key={value} value={value}>{frameworkCopy[value]}</option>)}</select></label>
                  <small>{script.frameworkReason || "No recommendation yet."}</small>
                </div>
                <div><span>Evidence</span><strong>{script.evidenceSignalIds.length} Reels</strong><small>Selected for this Script</small></div>
              </div>
              <div className="script-status-actions">
                {(script.runId || linting || drafting || storyboarding) && <span className="script-lock"><ArrowsClockwise className="spin" size={14} /> A Script run is in progress. Editing is paused.</span>}
                {!script.runId && dirty && <span className="script-dirty">Unsaved editor changes</span>}
                {script.status === "hook-selection" && !script.runId && <><p>{script.selectedHookId ? "The selected Hook is ready for the first Draft run." : "Choose a Hook before the first Draft run."}</p><button className="primary-button" type="button" onClick={() => void runDraft()} disabled={statusLocked || !script.selectedHookId}>{drafting ? <ArrowsClockwise className="spin" size={14} /> : <ArrowRight size={14} />} {drafting ? "Draft läuft…" : "Draft erstellen"}</button></>}
                {script.status === "draft" && <><button className="ghost-button" type="button" onClick={() => void runDraft()} disabled={statusLocked || !script.selectedHookId}>{drafting ? <ArrowsClockwise className="spin" size={14} /> : <ArrowsClockwise size={14} />} {drafting ? "Draft läuft…" : "Draft erneut erstellen"}</button><button className="primary-button" type="button" onClick={() => move("review")} disabled={statusLocked}>{moving === "review" ? <ArrowsClockwise className="spin" size={14} /> : <ArrowRight size={14} />} Send to Review</button></>}
                {script.status === "review" && <><button className="ghost-button" type="button" onClick={() => move("draft")} disabled={statusLocked}>{moving === "draft" ? <ArrowsClockwise className="spin" size={14} /> : <ArrowLeft size={14} />} Reopen Draft</button><button className="primary-button" type="button" onClick={() => move("approved")} disabled={statusLocked}>{moving === "approved" ? <ArrowsClockwise className="spin" size={14} /> : <CheckCircle size={14} />} Approve Script</button></>}
                {script.status === "approved" && <><span className="script-lock"><LockKey size={14} /> Approved scripts are locked.</span><button className="primary-button" type="button" onClick={() => void runStoryboard()} disabled={statusLocked}>{storyboarding ? <ArrowsClockwise className="spin" size={14} /> : <FileText size={14} />} {storyboarding ? "Storyboard läuft…" : payload.storyboard ? "Storyboard neu erzeugen" : "Storyboard erstellen"}</button><button className="ghost-button" type="button" onClick={() => move("draft")} disabled={statusLocked}>{moving === "draft" ? <ArrowsClockwise className="spin" size={14} /> : <ArrowCounterClockwiseIcon />} Reopen as Draft</button></>}
              </div>
              {error && <div className="strategy-error script-error"><WarningCircle size={18} weight="fill" /><p>{error}</p></div>}
            </section>

            <section className="panel script-options-panel"><div className="panel-head"><div><p className="kicker">Hook Selection</p><h2>Possible directions</h2><p>Each option carries its hypothesis, framework, evidence and topic fit. Choose one or write your own.</p></div></div><div className="script-option-grid">{script.hookOptions.map((option) => <article className={option.id === script.selectedHookId ? "script-option selected" : "script-option"} key={option.id}><div className="script-option-head"><span>{option.id === script.selectedHookId ? "Selected" : "Option"}{option.edited ? " · Edited" : ""}</span><strong>{frameworkCopy[option.framework]}</strong></div>{editingOption === option.id ? <div className="script-option-edit"><label>Hook<input value={editHook} onChange={(event) => setEditHook(event.target.value)} maxLength={400} /></label><label>Angle<textarea value={editAngle} onChange={(event) => setEditAngle(event.target.value)} maxLength={500} /></label><div><button className="primary-button" type="button" onClick={() => void saveOption(option.id)} disabled={saving}>Save option</button><button className="ghost-button" type="button" onClick={() => setEditingOption(null)}>Cancel</button></div></div> : <><h3>{option.hook}</h3><p>{option.angle}</p><dl><dt>Hypothesis</dt><dd>{option.hypothesis}</dd><dt>Belege</dt><dd>{option.evidence.length > 0 ? option.evidence.map((evidence) => <span className="script-option-evidence" key={evidence.signalId}>{evidence.hook} · {evidence.fit}</span>) : "No evidence attached."}</dd></dl><div className="script-option-actions">{option.id !== script.selectedHookId && <button className="ghost-button" type="button" onClick={() => void saveHookPatch({ selectedHookId: option.id })} disabled={script.status === "approved" || saving}>Choose Hook</button>}<button className="ghost-button" type="button" onClick={() => startEditing(option)} disabled={script.status === "approved" || saving}>Edit Hook + Angle</button></div></>}</article>)}</div><div className="script-custom-hook"><strong>Own Hook</strong><label>Hook<input value={customHook} onChange={(event) => setCustomHook(event.target.value)} placeholder="Sprich deinen eigenen ersten Satz." maxLength={400} /></label><label>Angle<textarea value={customAngle} onChange={(event) => setCustomAngle(event.target.value)} placeholder="Wofür steht dieser Einstieg?" maxLength={500} /></label><button className="secondary-button" type="button" onClick={() => void addOwnHook()} disabled={script.status === "approved" || saving || !customHook.trim() || !customAngle.trim()}>Add own Hook</button></div></section>

            <section className="panel script-editor-panel">
              <div className="panel-head script-editor-head">
                <div><p className="kicker">Source of truth</p><h2>Script editor</h2><p>Abschnitte and Leseansicht use the same ordered section list. Edit either side, then save the revision.</p></div>
                <div className="script-editor-actions"><span className={dirty ? "script-dirty" : "script-saved"}>{savedNotice || (editorLocked ? (script.status === "approved" ? "Locked" : script.runId || linting ? "Run in progress" : "Ready") : dirty ? "Unsaved" : "Saved")}</span><button className="ghost-button" type="button" onClick={() => void runLint()} disabled={editorLocked || dirty || !sections.length || saving || linting}>{linting ? <ArrowsClockwise className="spin" size={14} /> : <WarningCircle size={14} />} {linting ? "Lektorat läuft…" : "Lektorat starten"}</button><button className="primary-button" type="button" onClick={() => void saveEditor()} disabled={editorLocked || !dirty || saving}>{saving ? <ArrowsClockwise className="spin" size={14} /> : <CheckCircle size={14} />} {saving ? "Saving…" : "Save changes"}</button></div>
              </div>
              {sections.length === 0 ? <div className="empty-state">No complete draft yet. Hook Selection is waiting for the first Draft run.</div> : (
                <div className="script-editor-columns">
                  <section className="script-section-editor" aria-labelledby="script-sections-heading">
                    <div className="script-editor-column-head"><span className="kicker" id="script-sections-heading">Abschnitte</span><small>{sections.length} ordered sections</small></div>
                    <ol className="script-section-fields">
                      {sections.map((section, index) => <li key={`${section.kind}-${index}`}>
                        <div className="script-section-field-head"><span className={`script-section-kind kind-${section.kind}`}>{section.kind}</span><span>Section {index + 1}</span></div>
                        <label htmlFor={`script-section-label-${index}`}>Label</label>
                        <input id={`script-section-label-${index}`} value={section.label} maxLength={200} disabled={editorLocked} onChange={(event) => editSection(index, { label: event.target.value })} />
                        <label htmlFor={`script-section-text-${index}`}>Text</label>
                        <textarea id={`script-section-text-${index}`} value={section.text} maxLength={1200} disabled={editorLocked} onChange={(event) => editSection(index, { text: event.target.value })} />
                      </li>)}
                    </ol>
                  </section>
                  <section className="script-reading" aria-labelledby="script-reading-heading">
                    <div className="script-editor-column-head"><span className="kicker" id="script-reading-heading">Leseansicht</span><small>Same sections, continuous reading flow</small></div>
                    <ol className="script-reading-list">
                      {readingView.map((paragraph) => <li key={paragraph.sectionIndex}>
                        <textarea aria-label={`Leseansicht ${paragraph.label}`} value={paragraph.text} maxLength={1200} disabled={editorLocked} onChange={(event) => editSection(paragraph.sectionIndex, { text: event.target.value })} />
                      </li>)}
                    </ol>
                  </section>
                </div>
              )}
              {linting && <div className="script-lint-status"><ArrowsClockwise className="spin" size={15} /> Prüfe Regex- und Modell-Regeln. Der Abschnitt bleibt unverändert.</div>}
              {!linting && lintChecked && lintSuggestions.length === 0 && <div className="script-lint-status script-lint-clean"><CheckCircle size={15} /> Keine Slop-Stellen gefunden.</div>}
              {lintSuggestions.length > 0 && <div className="script-lint-results"><div className="script-lint-results-head"><div><p className="kicker">Lektorat</p><h3>{lintSuggestions.length} Vorschläge</h3><p>Übernimm nur, was zu deiner Stimme passt. Der Lauf ändert keinen Abschnitt automatisch.</p></div></div><div className="script-lint-list">{lintSuggestions.map((suggestion) => { const sectionIndex = script.sections.findIndex((_, index) => scriptSectionId(index) === suggestion.sectionId); const section = sectionIndex >= 0 ? script.sections[sectionIndex] : undefined; return <article className="script-lint-item" key={`${suggestion.sectionId}-${suggestion.original}`}><div className="script-lint-item-head"><span>{section ? `${section.label} · Abschnitt ${sectionIndex + 1}` : suggestion.sectionId}</span><button className="secondary-button" type="button" onClick={() => void acceptLintSuggestion(suggestion)} disabled={saving || linting || editorLocked}>{saving ? <ArrowsClockwise className="spin" size={13} /> : <CheckCircle size={13} />} Übernehmen</button></div><div className="script-lint-change"><span>{suggestion.original}</span><ArrowRight size={14} /><span>{suggestion.replacement}</span></div><p>{suggestion.reason}</p></article>; })}</div></div>}
            </section>

            <section className="panel script-evidence-panel"><div className="panel-head"><div><p className="kicker">Belege</p><h2>Evidence Reels</h2><p>These Reels stay attached to the Script as its evidence trail. The source Reel is kept separately.</p></div></div><div className="script-evidence-list">{script.evidenceSignalIds.map((id) => { const signal = payload.evidenceCandidates.find((item) => item.id === id) ?? payload.evidenceSignals.find((item) => item.id === id); return <div key={id}><span className="script-evidence-id">{id}</span>{signal?.url ? <a className="signal-link" href={signal.url} target="_blank" rel="noreferrer">{signal.title} <ArrowSquareOut size={11} /></a> : <span className="muted">{signal?.title ?? "Signal not available"}</span>}{script.status !== "approved" && <button className="ghost-button" type="button" onClick={() => void changeEvidence(id, false)} disabled={saving}>Remove</button>}</div>; })}</div>{script.status !== "approved" && <div className="script-evidence-available">{payload.evidenceCandidates.filter((candidate) => !script.evidenceSignalIds.includes(candidate.id)).map((candidate) => <div key={candidate.id}><span>{candidate.title}</span><button className="ghost-button" type="button" onClick={() => void changeEvidence(candidate.id, true)} disabled={saving}>Add</button></div>)}{payload.evidenceCandidates.filter((candidate) => !script.evidenceSignalIds.includes(candidate.id)).length === 0 && <span className="muted">No additional packet Reel is available.</span>}</div>}</section>
          </div>
        )}
      </main>
    </div>
  );
}

async function patchStoredScript(scriptId: string, patch: ScriptPatch): Promise<Script> {
  const response = await fetch(`/api/scripts/${encodeURIComponent(scriptId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await response.json().catch(() => ({}))) as { script?: Script; error?: string };
  if (!response.ok || !data.script) throw new Error(data.error || `HTTP ${response.status}`);
  return data.script;
}

function statusHint(status: ScriptStatus) {
  if (status === "hook-selection") return "A Hook run will prepare the first choice.";
  if (status === "draft") return "Ready for human review.";
  if (status === "review") return "Awaiting a manual decision.";
  return "Content is approved and locked.";
}

function ArrowCounterClockwiseIcon() {
  return <ArrowRight size={14} style={{ transform: "rotate(180deg)" }} />;
}
