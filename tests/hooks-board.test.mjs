import test from "node:test";
import assert from "node:assert/strict";
import { HOOK_COUNTS, HOOK_INPUT_MAX } from "../lib/config.ts";
import {
  HOOK_HYPOTHESES,
  groupHooks,
  hookRunKind,
  newHookRun,
  parseHookBoard,
  parseHookRequest,
  similarEvidence,
} from "../lib/hooks-board.ts";

const NOW = "2026-08-26T21:00:00.000Z";

const evidence = [
  {
    title: "Die besten drei Prompts für dein Team",
    creator: "@ada",
    caption: "Die besten drei Prompts für dein Team, in unter zwei Minuten erklärt.",
    plays: 120_000,
    outlier: 5.2,
  },
  {
    title: "Nie wieder Meetings ohne Protokoll",
    creator: "@bruno",
    caption: "Nie wieder Meetings ohne Protokoll. Der Agent schreibt mit.",
    plays: 80_000,
    outlier: 3.4,
  },
  {
    title: "Tag 14 der Journey",
    creator: "@cleo",
    caption: "Tag 14 der Journey: der erste Kunde kam über ein Reel.",
    plays: 40_000,
    outlier: 2.1,
  },
];

function board(overrides = []) {
  return {
    hooks: [
      {
        hook: "Dein Team schreibt Protokolle noch von Hand?",
        hypothesis: "curiosity",
        rationale: "Öffnet die Frage, die das Reel beantwortet.",
        evidence: ["Nie wieder Meetings ohne Protokoll"],
      },
      {
        hook: "Die besten drei Prompts, die dein Team heute braucht",
        hypothesis: "list",
        rationale: "Die Zahl trägt den Einstieg.",
        evidence: ["Die besten drei Prompts für dein Team"],
      },
      ...overrides,
    ],
  };
}

test("an input inside the ceiling is accepted and normalised", () => {
  const parsed = parseHookRequest({ source: "  Ein   Transkript\n\n\n mit Absätzen  ", count: 10 });
  assert.equal(parsed.source, "Ein Transkript\n\nmit Absätzen");
  assert.equal(parsed.count, 10);
  assert.equal(parsed.direction, undefined);
});

test("an input above 20000 characters is refused by name", () => {
  const source = "a".repeat(HOOK_INPUT_MAX + 300);
  assert.throws(
    () => parseHookRequest({ source, count: 10 }),
    (error) =>
      error.message.includes(String(HOOK_INPUT_MAX + 300)) && error.message.includes(String(HOOK_INPUT_MAX)),
  );
});

test("an input of exactly 20000 characters still passes", () => {
  const parsed = parseHookRequest({ source: "a".repeat(HOOK_INPUT_MAX), count: 5 });
  assert.equal(parsed.source.length, HOOK_INPUT_MAX);
});

test("an empty input is refused", () => {
  assert.throws(() => parseHookRequest({ source: "   ", count: 5 }), /transcript|idea|one line/i);
});

test("only the three allowed counts can be requested", () => {
  for (const count of HOOK_COUNTS) {
    assert.equal(parseHookRequest({ source: "Eine Idee", count }).count, count);
  }
  assert.throws(() => parseHookRequest({ source: "Eine Idee", count: 7 }), /5, 10 or 15/);
  assert.throws(() => parseHookRequest({ source: "Eine Idee", count: undefined }), /5, 10 or 15/);
});

test("the direction is optional and bounded", () => {
  const parsed = parseHookRequest({ source: "Eine Idee", count: 5, direction: `${"x".repeat(900)}` });
  assert.ok(parsed.direction.length < 900);
  assert.equal(parseHookRequest({ source: "Eine Idee", count: 5, direction: "  " }).direction, undefined);
});

test("a variant resolves its evidence titles against the packet", () => {
  const [variant] = parseHookBoard(board(), evidence);
  assert.equal(variant.hypothesis, "curiosity");
  assert.deepEqual(variant.evidence, [
    { hook: "Nie wieder Meetings ohne Protokoll", creator: "@bruno", outlier: 3.4 },
  ]);
});

test("a title the packet does not carry is dropped, never invented", () => {
  const variants = parseHookBoard(
    { hooks: [{ ...board().hooks[0], evidence: ["Ein Reel, das es nicht gibt", "Nie wieder Meetings ohne Protokoll"] }] },
    evidence,
  );
  assert.equal(variants[0].evidence.length, 1);
  assert.equal(variants[0].evidence[0].creator, "@bruno");
});

test("a variant without usable evidence falls back to the most similar outlier hooks", () => {
  const variants = parseHookBoard(
    { hooks: [{ hook: "Nie wieder Meetings ohne Protokoll schreiben", hypothesis: "promise", rationale: "Sagt das Ergebnis zuerst.", evidence: [] }] },
    evidence,
  );
  assert.ok(variants[0].evidence.length > 0);
  assert.equal(variants[0].evidence[0].creator, "@bruno");
});

test("an unknown hypothesis is refused by name", () => {
  assert.throws(
    () => parseHookBoard({ hooks: [{ ...board().hooks[0], hypothesis: "vibes" }] }, evidence),
    /vibes/,
  );
});

test("a hook without text is refused", () => {
  assert.throws(() => parseHookBoard({ hooks: [{ ...board().hooks[0], hook: "  " }] }, evidence), /hook/i);
});

test("an answer without hooks is refused", () => {
  assert.throws(() => parseHookBoard({ hooks: [] }, evidence), /at least one hook/i);
  assert.throws(() => parseHookBoard(null, evidence), /object/i);
});

test("similar evidence ranks the closest outlier hook first", () => {
  const [first] = similarEvidence("Die besten Prompts für dein Team", evidence, 2);
  assert.equal(first.creator, "@ada");
});

test("groups keep the canonical hypothesis order and drop the empty ones", () => {
  const groups = groupHooks(parseHookBoard(board(), evidence));
  assert.deepEqual(groups.map((group) => group.hypothesis), ["curiosity", "list"]);
  assert.equal(groups[0].label, HOOK_HYPOTHESES[0].label);
  assert.equal(groups[0].variants.length, 1);
});

test("two variants of the same hypothesis land in one group", () => {
  const groups = groupHooks(
    parseHookBoard(board([{ hook: "Was dein Team heute falsch macht", hypothesis: "curiosity", rationale: "Offene Schleife.", evidence: [] }]), evidence),
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0].variants.length, 2);
});

test("a long input reads as a transcript, a short one as a one liner", () => {
  assert.equal(hookRunKind(20), "one-liner");
  assert.equal(hookRunKind(12_000), "transcript");
});

test("a run keeps the character count, an excerpt and its groups", () => {
  const groups = groupHooks(parseHookBoard(board(), evidence));
  const run = newHookRun(
    { source: `${"Ein langes Transkript. ".repeat(60)}`, count: 10, direction: "Für Agenturen" },
    { id: "hook-run-1", now: NOW, groups, evidenceCount: evidence.length },
  );
  assert.equal(run.id, "hook-run-1");
  assert.equal(run.createdAt, NOW);
  assert.equal(run.requested, 10);
  assert.equal(run.kind, "transcript");
  assert.equal(run.direction, "Für Agenturen");
  assert.equal(run.sourceLength, "Ein langes Transkript. ".repeat(60).trim().length);
  assert.ok(run.sourceExcerpt.length < run.sourceLength);
  assert.equal(run.groups.length, 2);
  assert.equal(run.evidenceCount, 3);
});

test("two runs over the same input stay separate entries", () => {
  const groups = groupHooks(parseHookBoard(board(), evidence));
  const input = { source: "Die gleiche Idee", count: 5 };
  const first = newHookRun(input, { id: "hook-run-a", now: NOW, groups, evidenceCount: 3 });
  const second = newHookRun(input, { id: "hook-run-b", now: NOW, groups, evidenceCount: 3 });
  assert.notEqual(first.id, second.id);
});
