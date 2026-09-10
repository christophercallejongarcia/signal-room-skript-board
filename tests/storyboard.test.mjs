import test from "node:test";
import assert from "node:assert/strict";
import { parseScriptStoryboardAnswer } from "../lib/storyboard.ts";

const script = {
  id: "script-approved",
  revision: 4,
  sections: [
    { kind: "hook", label: "Hook", text: "Ein guter Beleg beginnt mit einer klaren Entscheidung." },
    { kind: "beat", label: "Problem", text: "Viele Briefings sammeln Material ohne eine Richtung festzulegen." },
    { kind: "beat", label: "Regel", text: "Eine überprüfbare Regel hält die Auswahl klein." },
    { kind: "cta", label: "CTA", text: "Prüfe dein nächstes Briefing auf genau eine Entscheidung." },
  ],
};

const answer = {
  hook: "Eine Antwort, die nicht gespeichert werden darf.",
  beats: [
    { label: "Engpass", detail: "Das Briefing braucht zuerst eine sichtbare Richtung." },
    { label: "Auswahl", detail: "Drei Belege reichen für eine belastbare Entscheidung." },
    { label: "Prüfung", detail: "Alles andere muss die Auswahl verlassen." },
  ],
  cta: "Prüfe beim nächsten Briefing zuerst die Entscheidung.",
  caption: "Ein Briefing ist eine Auswahl.\nDie Belege folgen erst danach.",
  takeaway: "Der Zuschauer kann sein nächstes Briefing kürzen.",
};

test("a Script Storyboard uses the approved Script hook and records its revision", () => {
  const storyboard = parseScriptStoryboardAnswer(answer, script);
  assert.equal(storyboard.hook, script.sections[0].text);
  assert.equal(storyboard.scriptId, "script-approved");
  assert.equal(storyboard.scriptRevision, 4);
  assert.equal(storyboard.commentCta, "");
  assert.equal(storyboard.leadMagnetCta, "");
});

test("a Script Storyboard rejects a caption line that repeats its hook", () => {
  assert.throws(
    () => parseScriptStoryboardAnswer({ ...answer, caption: `  ${script.sections[0].text.toUpperCase()}  \nEin anderer Satz.` }, script),
    /duplicates the Hook/,
  );
});

test("a Script Storyboard rejects duplicate beat details, CTA and caption lines", () => {
  assert.throws(
    () => parseScriptStoryboardAnswer({ ...answer, beats: [answer.beats[0], { ...answer.beats[1], detail: answer.beats[0].detail }, answer.beats[2]] }, script),
    /duplicates Beat 1/,
  );
  assert.throws(
    () => parseScriptStoryboardAnswer({ ...answer, cta: answer.beats[1].detail }, script),
    /CTA duplicates Beat 2/,
  );
  assert.throws(
    () => parseScriptStoryboardAnswer({ ...answer, caption: `Erste Zeile.\n${answer.cta}` }, script),
    /Caption line 2 duplicates CTA/,
  );
});
