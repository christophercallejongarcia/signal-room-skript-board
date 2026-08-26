import {
  HOOK_COUNTS,
  HOOK_DIRECTION_MAX,
  HOOK_EVIDENCE_PER_VARIANT,
  HOOK_INPUT_MAX,
  HOOK_LINE_MAX,
  HOOK_RATIONALE_MAX,
  HOOK_SOURCE_EXCERPT,
  HOOK_TRANSCRIPT_MIN,
} from "./config.ts";
import type { HookEvidence, HookGroup, HookHypothesis, HookRun, HookVariant, StrategyEvidenceItem } from "./contracts";
import { bounded, boundedText } from "./ideas.ts";

/**
 * The five hypotheses, in the order the board reads them. A variant tests exactly
 * one; the group heading is the hypothesis, not a category above it.
 */
export const HOOK_HYPOTHESES: { id: HookHypothesis; label: string; hint: string }[] = [
  {
    id: "curiosity",
    label: "Neugier-Lücke",
    hint: "Öffnet eine Frage, die erst das Reel schließt",
  },
  {
    id: "list",
    label: "Liste",
    hint: "Nennt die Zahl vorweg, der Zuschauer bleibt für die Punkte",
  },
  {
    id: "contrast",
    label: "Kontrast",
    hint: "Stellt zwei Wege gegeneinander, das Urteil kommt im Reel",
  },
  {
    id: "promise",
    label: "Versprechen",
    hint: "Sagt das Ergebnis zuerst zu und belegt es danach",
  },
  {
    id: "story",
    label: "Story",
    hint: "Startet mitten in einer Szene, der Ausgang fehlt noch",
  },
];

const hypothesisById = new Map(HOOK_HYPOTHESES.map((entry) => [entry.id, entry]));

/** What one Hooks-Board run is generated from. The source is already normalised. */
export type HookRequestInput = { source: string; direction?: string; count: number };

/**
 * Validates one board request. The ceiling is checked on the pasted text, before
 * normalisation, so the refusal names the number the person can see in the field.
 */
export function parseHookRequest(input: Partial<HookRequestInput> | undefined): HookRequestInput {
  const raw = typeof input?.source === "string" ? input.source.trim() : "";
  if (!raw) throw new Error("Paste a transcript, an idea, or one line first.");
  if (raw.length > HOOK_INPUT_MAX) {
    throw new Error(
      `The input is ${raw.length} characters. The Hooks board takes up to ${HOOK_INPUT_MAX}, so cut it down first.`,
    );
  }
  const count = Number(input?.count);
  if (!HOOK_COUNTS.includes(count as (typeof HOOK_COUNTS)[number])) {
    throw new Error(`A run returns ${HOOK_COUNTS.slice(0, -1).join(", ")} or ${HOOK_COUNTS.at(-1)} hooks.`);
  }
  const direction = bounded(input?.direction, HOOK_DIRECTION_MAX);

  return {
    source: boundedText(raw, HOOK_INPUT_MAX),
    count,
    ...(direction ? { direction } : {}),
  };
}

/** Longer than this reads as a transcript; shorter is an idea or a single line. */
export function hookRunKind(sourceLength: number): HookRun["kind"] {
  return sourceLength >= HOOK_TRANSCRIPT_MIN ? "transcript" : "one-liner";
}

/** German and English filler that carries no signal when two hooks are compared. */
const STOPWORDS = new Set([
  "aber", "auch", "dein", "deine", "dass", "denn", "dich", "diese", "dieser", "dieses", "doch",
  "eine", "einen", "einer", "eines", "euer", "eure", "have", "hier", "ihre", "immer", "kann",
  "mehr", "mein", "meine", "nach", "nicht", "noch", "oder", "ohne", "schon", "sein", "sich",
  "sind", "that", "this", "über", "unter", "vom", "von", "wenn", "were", "what", "wie", "wird",
  "with", "your",
]);

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{Nd}]+/u)
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
  );
}

/** Jaccard over the content words. Small corpus, so a readable measure beats a clever one. */
function overlap(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Instagram derives the title from the first caption line, so the title of an
 * evidence reel already is its Hook. It is what a Beleg shows.
 */
function asEvidence(item: StrategyEvidenceItem): HookEvidence {
  return {
    hook: bounded(item.title, HOOK_LINE_MAX) || bounded(item.caption, HOOK_LINE_MAX),
    creator: item.creator,
    outlier: item.outlier,
  };
}

/**
 * The outlier reels whose own hook reads closest to this one. Used when a variant
 * names no packet entry of its own, so every variant still shows a real reel.
 */
export function similarEvidence(
  hook: string,
  evidence: StrategyEvidenceItem[],
  limit = HOOK_EVIDENCE_PER_VARIANT,
): HookEvidence[] {
  const wanted = tokens(hook);
  return evidence
    .map((item) => ({ item, score: overlap(wanted, tokens(`${item.title} ${item.caption}`)) }))
    // The strongest outlier breaks a tie, which is also the answer when nothing overlaps.
    .sort((a, b) => b.score - a.score || b.item.outlier - a.item.outlier)
    .slice(0, limit)
    .map(({ item }) => asEvidence(item));
}

/** Reads a hypothesis id the Bridge returned, or refuses it by name. */
function hypothesisOf(value: unknown, index: number): HookHypothesis {
  const id = bounded(value, 40).toLowerCase();
  if (!hypothesisById.has(id as HookHypothesis)) {
    throw new Error(`Hook ${index + 1} carries the unknown hypothesis "${id || "(empty)"}".`);
  }
  return id as HookHypothesis;
}

export type HookBoardOptions = { evidencePerVariant?: number };

/**
 * Validates what the Bridge returned and hangs the corpus evidence on it. A cited
 * title that is not in the packet is dropped: the board only ever shows reels the
 * app itself selected.
 */
export function parseHookBoard(
  value: unknown,
  evidence: StrategyEvidenceItem[],
  options: HookBoardOptions = {},
): HookVariant[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The hooks answer must be an object.");
  }
  const raw = (value as { hooks?: unknown }).hooks;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("The hooks answer needs at least one hook.");
  const perVariant = options.evidencePerVariant ?? HOOK_EVIDENCE_PER_VARIANT;
  const byTitle = new Map(evidence.map((item) => [item.title.toLowerCase().trim(), item]));

  return raw.map((entry, index) => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const hook = bounded(item.hook, HOOK_LINE_MAX);
    if (!hook) throw new Error(`Hook ${index + 1} has no hook line.`);
    const hypothesis = hypothesisOf(item.hypothesis, index);
    const rationale = bounded(item.rationale, HOOK_RATIONALE_MAX);
    if (!rationale) throw new Error(`Hook ${index + 1} has no rationale.`);

    const cited: HookEvidence[] = [];
    const seen = new Set<string>();
    for (const title of Array.isArray(item.evidence) ? item.evidence : []) {
      const key = bounded(title, 300).toLowerCase();
      const match = byTitle.get(key);
      if (!match || seen.has(key)) continue;
      seen.add(key);
      cited.push(asEvidence(match));
      if (cited.length >= perVariant) break;
    }

    return {
      hook,
      hypothesis,
      rationale,
      evidence: cited.length > 0 ? cited : similarEvidence(hook, evidence, perVariant),
    };
  });
}

/** The board itself: variants under their hypothesis, canonical order, no empty sections. */
export function groupHooks(variants: HookVariant[]): HookGroup[] {
  return HOOK_HYPOTHESES.map(({ id, label, hint }) => ({
    hypothesis: id,
    label,
    hint,
    variants: variants.filter((variant) => variant.hypothesis === id),
  })).filter((group) => group.variants.length > 0);
}

/** One logged run. The caller owns id and clock, so this stays pure. */
export function newHookRun(
  input: HookRequestInput,
  options: { id: string; now: string; groups: HookGroup[]; evidenceCount: number },
): HookRun {
  const sourceLength = input.source.trim().length;
  return {
    id: options.id,
    createdAt: options.now,
    sourceExcerpt: bounded(input.source, HOOK_SOURCE_EXCERPT),
    sourceLength,
    ...(input.direction ? { direction: input.direction } : {}),
    requested: input.count,
    kind: hookRunKind(sourceLength),
    groups: options.groups,
    evidenceCount: options.evidenceCount,
  };
}
