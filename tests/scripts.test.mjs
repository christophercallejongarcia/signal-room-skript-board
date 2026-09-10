import test from "node:test";
import assert from "node:assert/strict";
import {
  addCustomHookOption,
  ForbiddenMoveError,
  ScriptRunConflictError,
  SCRIPT_STATUSES,
  canTransition,
  claimScriptRun,
  countByStatus,
  editHookOption,
  moveScript,
  newScript,
  parseScriptPatch,
  parseScriptHooksAnswer,
  parseScriptMove,
  parseScriptSections,
  patchScript,
  renderScriptReadingView,
  selectHookOption,
  settleScriptRun,
  updateScriptSection,
  validateScriptWrite,
} from "../lib/scripts.ts";

const NOW = "2026-08-31T09:00:00.000Z";
const LATER = "2026-08-31T09:05:00.000Z";

const sections = [
  { kind: "hook", label: "Hook", text: "Der Hook setzt die Richtung." },
  { kind: "beat", label: "Problem", text: "Zeige den Engpass, den das Publikum kennt." },
  { kind: "beat", label: "Beleg", text: "Zeige eine konkrete Beobachtung aus dem Reel." },
  { kind: "cta", label: "CTA", text: "Prüfe die Regel beim nächsten Beitrag." },
];

function emptyScript() {
  return newScript({ ideaId: "idea-1", sourceSignalId: "signal-1", evidenceSignalIds: ["signal-1", "signal-2", "signal-2"] }, { id: "script-1", now: NOW });
}

test("a new Script starts in Hook-Selection with bounded references", () => {
  const script = emptyScript();
  assert.equal(script.status, "hook-selection");
  assert.deepEqual(script.evidenceSignalIds, ["signal-1", "signal-2"]);
  assert.equal(script.framework, "none");
  assert.deepEqual(script.sections, []);
  assert.equal(script.revision, 0);
  assert.equal(script.createdAt, NOW);
});

test("the Script status model exposes every status and only the specified manual moves", () => {
  assert.deepEqual(SCRIPT_STATUSES, ["hook-selection", "draft", "review", "approved"]);
  assert.equal(canTransition("hook-selection", "draft"), false);
  assert.equal(canTransition("draft", "review"), true);
  assert.equal(canTransition("review", "draft"), true);
  assert.equal(canTransition("review", "approved"), true);
  assert.equal(canTransition("approved", "draft"), true);
  assert.equal(canTransition("draft", "approved"), false);
  assert.equal(canTransition("approved", "review"), false);
});

test("Hook-Selection reaches Draft only when the claimed Draft run settles", () => {
  const claimed = claimScriptRun(emptyScript(), "run-a", LATER);
  assert.throws(() => moveScript(claimed, "draft", LATER), ForbiddenMoveError);
  const drafted = settleScriptRun(claimed, "run-a", { now: LATER, status: "draft", sections });
  assert.equal(drafted.status, "draft");
  assert.equal(drafted.runId, undefined);
  assert.equal(drafted.revision, 1);
  assert.deepEqual(drafted.sections, sections);
});

test("every allowed manual move works and approval records the approved revision", () => {
  let script = settleScriptRun(claimScriptRun(emptyScript(), "run-a", NOW), "run-a", { now: NOW, status: "draft", sections });
  script = moveScript(script, "review", LATER);
  assert.equal(script.status, "review");
  script = moveScript(script, "draft", NOW);
  assert.equal(script.status, "draft");
  script = moveScript(script, "review", LATER);
  script = moveScript(script, "approved", LATER);
  assert.equal(script.status, "approved");
  assert.equal(script.approvedRevision, script.revision);
  assert.equal(script.approvedAt, LATER);
});

test("reopening an approved Script moves it to Draft and advances the revision", () => {
  const drafted = settleScriptRun(claimScriptRun(emptyScript(), "run-a", NOW), "run-a", { now: NOW, status: "draft", sections });
  const approved = moveScript(moveScript(drafted, "review", LATER), "approved", LATER);
  const reopened = moveScript(approved, "draft", "2026-09-01T09:00:00.000Z");
  assert.equal(reopened.status, "draft");
  assert.equal(reopened.revision, approved.revision + 1);
  assert.equal(reopened.approvedRevision, approved.revision);
  assert.equal(reopened.approvedAt, LATER);
});

test("the approved lock also applies to whole-row writes", () => {
  const drafted = settleScriptRun(claimScriptRun(emptyScript(), "run-a", NOW), "run-a", { now: NOW, status: "draft", sections });
  const approved = moveScript(moveScript(drafted, "review", LATER), "approved", LATER);
  assert.doesNotThrow(() => validateScriptWrite(approved, approved));
  assert.throws(
    () => validateScriptWrite(approved, { ...approved, frameworkReason: "changed behind the lock" }),
    ForbiddenMoveError,
  );
  assert.doesNotThrow(() => validateScriptWrite(approved, moveScript(approved, "draft", "2026-09-01T12:00:00.000Z")));
});

test("a forbidden move has the same error class as Idea moves", () => {
  assert.throws(() => moveScript(emptyScript(), "review", LATER), ForbiddenMoveError);
  assert.throws(() => moveScript(emptyScript(), "review", LATER), /cannot move from hook-selection to review/);
  const approved = { ...emptyScript(), status: "approved", revision: 1, approvedRevision: 1, approvedAt: NOW };
  assert.throws(() => moveScript(approved, "review", LATER), /cannot move from approved to review/);
});

test("a newer run wins and a stale settle cannot overwrite it", () => {
  const first = claimScriptRun(emptyScript(), "run-a", NOW);
  const second = claimScriptRun(first, "run-b", LATER);
  assert.equal(settleScriptRun(second, "run-a", { now: LATER, status: "draft", sections }), null);
  const settled = settleScriptRun(second, "run-b", { now: LATER, status: "draft", sections });
  assert.equal(settled.runId, undefined);
  assert.equal(settled.status, "draft");
});

test("a guarded Script claim rejects a second active run", () => {
  const first = claimScriptRun(emptyScript(), "run-a", NOW);
  assert.throws(() => claimScriptRun(first, "run-b", LATER, { rejectIfRunning: true }), ScriptRunConflictError);
});

test("an approved Script accepts only an explicitly read-only run claim", () => {
  const drafted = settleScriptRun(claimScriptRun(emptyScript(), "run-a", NOW), "run-a", { now: NOW, status: "draft", sections });
  const approved = moveScript(moveScript(drafted, "review", LATER), "approved", LATER);
  assert.throws(() => claimScriptRun(approved, "run-b", LATER), ForbiddenMoveError);
  const claimed = claimScriptRun(approved, "run-b", LATER, { allowApproved: true, rejectIfRunning: true });
  const released = settleScriptRun(claimed, "run-b", { now: LATER });
  assert.equal(released.status, "approved");
  assert.equal(released.revision, approved.revision);
  assert.equal(released.runId, undefined);
});

test("Hook-Options can be selected and edited, but an approved Script is immutable", () => {
  const option = { id: "hook-1", hook: "Der erste Satz.", angle: "Ein Angle.", hypothesis: "Eine Hypothese.", framework: "pas", evidence: [], edited: false };
  let script = { ...emptyScript(), hookOptions: [option] };
  script = selectHookOption(script, "hook-1", LATER);
  assert.equal(script.selectedHookId, "hook-1");
  script = editHookOption(script, "hook-1", { hook: "Mein eigener Hook.", angle: "Mein eigener Angle." }, NOW);
  assert.equal(script.hookOptions[0].edited, true);
  assert.equal(script.hookOptions[0].hook, "Mein eigener Hook.");
  assert.throws(() => selectHookOption({ ...script, status: "approved" }, "hook-1", LATER), ForbiddenMoveError);
});

test("sections require exactly one Hook and CTA plus two to five Beats", () => {
  assert.deepEqual(parseScriptSections(sections), sections);
  assert.throws(() => parseScriptSections(sections.filter((section) => section.kind !== "hook")), /exactly one hook/);
  assert.throws(() => parseScriptSections(sections.filter((section) => section.kind !== "cta")), /exactly one CTA/);
  assert.throws(() => parseScriptSections(sections.slice(0, 3)), /exactly one CTA|between two and five/);
  assert.throws(() => parseScriptSections([...sections, { kind: "beat", label: "Extra", text: "Noch ein Beat." }, { kind: "beat", label: "Extra 2", text: "Noch ein Beat." }, { kind: "beat", label: "Extra 3", text: "Noch ein Beat." }, { kind: "beat", label: "Extra 4", text: "Noch ein Beat." }]), /between two and five/);
  assert.equal(parseScriptSections(sections.map((section) => ({ ...section, text: "x".repeat(2000) })))[0].text.length, 1200);
});

test("the reading view preserves each source section index and writes back to that section only", () => {
  const reading = renderScriptReadingView(sections);
  assert.deepEqual(reading.map((paragraph) => paragraph.sectionIndex), [0, 1, 2, 3]);
  assert.equal(reading[1].text, sections[1].text);
  const updated = updateScriptSection(sections, reading[1].sectionIndex, { text: "Der geänderte Beleg." });
  assert.equal(updated[1].text, "Der geänderte Beleg.");
  assert.equal(updated[0].text, sections[0].text);
  assert.equal(sections[1].text, "Zeige den Engpass, den das Publikum kennt.");
});

test("the editor PATCH parser bounds section text and keeps the structure invariant", () => {
  const parsed = parseScriptPatch({ sections: sections.map((section) => ({ ...section, text: "x".repeat(2000) })), framework: "bbb" });
  assert.equal(parsed.framework, "bbb");
  assert.equal(parsed.sections[0].text.length, 1200);
  assert.throws(() => parseScriptPatch({ framework: "unknown" }), /framework must be one of/);
  assert.throws(() => parseScriptPatch({ sections: sections.slice(0, 3) }), /exactly one CTA|between two and five/);
  assert.throws(() => parseScriptPatch({}), /PATCH needs/);
});

test("Script Hook answers resolve evidence titles against the accepted packet", () => {
  const evidence = [
    { id: "signal-1", title: "Die Quelle", creator: "@studio", caption: "", plays: 10_000, outlier: 2.5 },
    { id: "signal-2", title: "Der Beleg", creator: "@fieldnotes", caption: "", plays: 12_000, outlier: 3.1 },
  ];
  const answer = {
    options: [1, 2, 3].map((number) => ({
      hook: `Ein anderer Hook ${number}.`,
      angle: `Ein anderer Angle ${number}.`,
      hypothesis: `Eine andere Hypothese ${number}.`,
      framework: "none",
      evidence: [
        { title: "Die Quelle", fit: "Die Struktur passt." },
        { title: "Nicht im Paket", fit: "Darf nicht gespeichert werden." },
      ],
    })),
    frameworkRecommendation: { framework: "none", reason: "Die natürliche Reihenfolge bleibt klar." },
  };
  const parsed = parseScriptHooksAnswer(answer, evidence);
  assert.equal(parsed.hookOptions.length, 3);
  assert.deepEqual(parsed.hookOptions[0].evidence.map((item) => item.signalId), ["signal-1"]);
  assert.equal(parsed.hookOptions[0].evidence[0].hook, "Die Quelle");
  assert.throws(() => parseScriptHooksAnswer({ ...answer, options: answer.options.map((option) => ({ ...option, hook: "Doppelt" })) }, evidence), /duplicates/);
});

test("a human can add an own Hook and change or clear the Script framework", () => {
  const script = { ...emptyScript(), framework: "pas" };
  const custom = addCustomHookOption(script, { hook: "Mein eigener Einstieg.", angle: "Zeige die Regel am Beispiel." }, LATER);
  assert.equal(custom.selectedHookId, "custom-1");
  assert.equal(custom.hookOptions[0].edited, true);
  assert.equal(patchScript(custom, { framework: "none" }, LATER).framework, "none");
  const selected = patchScript(custom, { selectedHookId: null }, LATER);
  assert.equal(selected.selectedHookId, undefined);
});

test("the editor PATCH logic revises sections and enforces manual status moves", () => {
  const drafted = settleScriptRun(claimScriptRun(emptyScript(), "run-a", NOW), "run-a", { now: NOW, status: "draft", sections });
  const changed = patchScript(drafted, { sections: sections.map((section) => ({ ...section, text: `${section.text} Weiter.` })) }, LATER);
  assert.equal(changed.revision, drafted.revision + 1);
  assert.match(changed.sections[0].text, /Weiter/);
  const review = patchScript(changed, { status: "review" }, LATER);
  assert.equal(review.status, "review");
  const approved = patchScript(review, { status: "approved" }, LATER);
  assert.equal(approved.approvedRevision, approved.revision);
  assert.throws(() => patchScript(approved, { sections }, LATER), ForbiddenMoveError);
  const reopened = patchScript(approved, { status: "draft" }, "2026-09-01T09:00:00.000Z");
  assert.equal(reopened.revision, approved.revision + 1);
  assert.equal(reopened.approvedRevision, approved.revision);
  assert.throws(() => patchScript(review, { status: "hook-selection" }, LATER), /cannot move from review to hook-selection/);
});

test("the status body parser trims ids and rejects unknown statuses", () => {
  assert.deepEqual(parseScriptMove({ id: " script-1 ", status: "review" }), { id: "script-1", status: "review" });
  assert.throws(() => parseScriptMove({ status: "review" }), /id required/);
  assert.throws(() => parseScriptMove({ id: "script-1", status: "drafting" }), /status must be one of/);
});

test("the Scripts counter includes zeroes and ignores unknown stored statuses", () => {
  const script = emptyScript();
  assert.deepEqual(countByStatus([
    script,
    { ...script, id: "2", status: "draft" },
    { ...script, id: "3", status: "review" },
    { ...script, id: "4", status: "approved" },
    { ...script, id: "5", status: "unknown" },
  ]), { "hook-selection": 1, draft: 1, review: 1, approved: 1 });
});
