import test from "node:test";
import assert from "node:assert/strict";
import { hookOf, spokenHook } from "../lib/hook-source.ts";

test("hookOf reads the spoken opening when a transcript exists, else the first caption line", () => {
  assert.equal(hookOf({ title: "t", caption: "🔥 Nie wieder Copy-Paste\nzweite Zeile" }), "Nie wieder Copy-Paste");
  assert.equal(hookOf({ title: "Untitled reel", caption: "🔥🔥🔥", transcript: "Hör auf mit Notion! Das ist der Grund." }), "Hör auf mit Notion!");
  assert.equal(hookOf({ title: "Reel title" }), "Reel title");
});

test("hookOf prefers the corrected working copy over the original transcript", () => {
  assert.equal(
    hookOf({
      title: "Untitled reel",
      transcript: "Das ist ein Thumnail.",
      transcriptWorkingCopy: "Das ist ein Thumbnail.",
    }),
    "Das ist ein Thumbnail.",
  );
});

test("spokenHook bounds a long first sentence at a word boundary", () => {
  const long = `${"wort ".repeat(60)}ende.`;
  const hook = spokenHook(long);
  assert.ok(hook.length <= 121, hook);
  assert.ok(hook.endsWith("…"));
  assert.equal(spokenHook("   "), "");
});

test("a full stop after a digit is an ordinal, not the end of the spoken hook", () => {
  assert.equal(spokenHook("2. Tipp: schreib das auf. Dann geht es weiter."), "2. Tipp: schreib das auf.");
});
