import { FORMAT_WINDOW_DAYS, FORMAT_EXAMPLE_LIMIT, OUTLIER_THRESHOLD } from "./config.ts";
import type { Creator, RankedSignal } from "./contracts";
import { isOutlier, isOwned } from "./discover-filter.ts";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** The bucket every outlier reel without a recognised pattern lands in. */
export const UNCLASSIFIED = "unclassified";

/** One recognisable hook shape. Add an entry here and the whole tab picks it up. */
export type FormatPattern = {
  id: string;
  /** Shown as the section heading. Reads as the pattern itself, not as a category. */
  label: string;
  /** One line on why the shape works. */
  hint: string;
  /** Tested against the normalised hook line. */
  match: RegExp;
};

/**
 * Ordered, first match wins. Anchored German idioms come first, so "Tag 14 der
 * Journey" is a journey post and not merely a number opener. The closing
 * question mark follows, because it outranks the loose openers below it:
 * "Wie kriegst du das hin?" is a question, not an instruction.
 */
export const FORMAT_PATTERNS: FormatPattern[] = [
  {
    id: "kommentiere",
    label: "Kommentiere X",
    hint: "Asks for one keyword and turns the comment count into the distribution",
    match: /^kommentier(e|t|st)?\b/i,
  },
  {
    id: "die-besten",
    label: "Die besten X",
    hint: "A ranked shortlist, the curiosity gap plus the time saved",
    match: /^die\s+(\d+\s+)?besten\b/i,
  },
  {
    id: "tag-n",
    label: "Tag N der Journey",
    hint: "Serial progress, the count itself is the reason to come back",
    match: /^tag\s+\d+\b/i,
  },
  {
    id: "nie-wieder",
    label: "Nie wieder X",
    hint: "Names the pain first and promises it is over",
    match: /^nie\s+(wieder|mehr)\b/i,
  },
  {
    id: "der-geheime",
    label: "Der geheime X",
    hint: "Withheld knowledge, the viewer stays for the reveal",
    match: /^(der|die|das)\s+(geheim|heimlich)\w*\b/i,
  },
  {
    id: "hoer-auf",
    label: "Hör auf mit X",
    hint: "A direct stop order, the viewer checks whether they are the target",
    match: /^(h(ö|oe)r(e)?\s+auf|stopp?)\b/i,
  },
  {
    id: "question",
    label: "Question",
    hint: "The hook is the open loop the reel closes",
    match: /\?\s*$/,
  },
  {
    id: "so-machst-du",
    label: "So machst du X",
    hint: "Straight instruction, the payoff is stated before the steps",
    match: /^(so|wie)\s+\S/i,
  },
  {
    id: "x-vs-y",
    label: "X vs. Y",
    hint: "Two named options, the viewer wants the verdict",
    match: /\bvs\.?\b/i,
  },
  {
    id: "number-first",
    label: "Number first",
    hint: "A count in the first word, the length of the payoff is known upfront",
    match: /^\p{Nd}/u,
  },
];

/**
 * The hook of a caption: its first non-empty line, leading decoration removed.
 * Emoji and punctuation are stripped from the front only, so a closing question
 * mark survives.
 */
export function hookLine(caption: string | undefined) {
  const line = (caption ?? "").split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return line.replace(/^[^\p{L}\p{Nd}]+/u, "").replace(/\s+/g, " ").trim();
}

const patternById = new Map(FORMAT_PATTERNS.map((pattern) => [pattern.id, pattern]));

/** Pure over one caption: the id of the first matching pattern, or UNCLASSIFIED. */
export function classifyCaption(caption: string | undefined): string {
  const hook = hookLine(caption);
  if (!hook) return UNCLASSIFIED;
  return FORMAT_PATTERNS.find((pattern) => pattern.match.test(hook))?.id ?? UNCLASSIFIED;
}

/** The heading a pattern id reads under. Unknown ids fall back to the id itself. */
export function patternLabel(id: string) {
  return patternById.get(id)?.label ?? id;
}

/** One pattern with its numbers over the read window. */
export type FormatSignal = {
  id: string;
  label: string;
  hint: string;
  /** Outlier reels carrying this pattern. */
  count: number;
  /** Mean outlier of those reels, one decimal. */
  averageOutlier: number;
  /** count divided by every outlier reel in the group, 0 to 1. */
  share: number;
  /** Strongest first, at most FORMAT_EXAMPLE_LIMIT. */
  examples: RankedSignal[];
  /** Reels per week over the window, oldest bucket first. */
  weeks: number[];
};

/**
 * One side of the tab. "own" is the niche, "foreign" holds creators marked
 * `foreign` so imported shapes never move the own numbers.
 */
export type FormatSignalGroup = {
  scope: "own" | "foreign";
  /** Outlier reels read for this group. The share denominator. */
  total: number;
  signals: FormatSignal[];
};

export type FormatSignalOptions = {
  /** Epoch ms the window is measured from. */
  now?: number;
  windowDays?: number;
  threshold?: number;
  exampleLimit?: number;
};

/**
 * Instagram derives the title from the first caption line, so the title is the
 * honest stand-in when a record carries no caption of its own.
 */
function captionOf(signal: RankedSignal) {
  return signal.caption ?? signal.title;
}

/** Everything groupByPattern needs beyond the reels themselves. */
type GroupSettings = { now: number; weekCount: number; exampleLimit: number };

function groupByPattern(scope: "own" | "foreign", reels: RankedSignal[], settings: GroupSettings): FormatSignalGroup {
  const { now, weekCount, exampleLimit } = settings;
  const buckets = new Map<string, RankedSignal[]>();
  for (const reel of reels) {
    const id = classifyCaption(captionOf(reel));
    const bucket = buckets.get(id);
    if (bucket) bucket.push(reel);
    else buckets.set(id, [reel]);
  }

  const signals: FormatSignal[] = [...buckets.entries()].map(([id, group]) => {
    const pattern = patternById.get(id);
    const weeks = new Array<number>(weekCount).fill(0);
    for (const reel of group) {
      const age = Math.max(0, now - new Date(reel.publishedAt).getTime());
      const index = weekCount - 1 - Math.min(weekCount - 1, Math.floor(age / WEEK));
      weeks[index] += 1;
    }
    const sum = group.reduce((total, reel) => total + reel.outlier, 0);
    return {
      id,
      label: pattern?.label ?? "Unclassified",
      hint: pattern?.hint ?? "No known shape in the first caption line",
      count: group.length,
      averageOutlier: Math.round((sum / group.length) * 10) / 10,
      share: group.length / reels.length,
      examples: [...group].sort((a, b) => b.outlier - a.outlier).slice(0, exampleLimit),
      weeks,
    };
  });

  // Unclassified is a residue, not a pattern: it reports its share from the bottom.
  signals.sort((a, b) => {
    if (a.id === UNCLASSIFIED) return 1;
    if (b.id === UNCLASSIFIED) return -1;
    return b.averageOutlier - a.averageOutlier || b.count - a.count || a.label.localeCompare(b.label);
  });

  return { scope, total: reels.length, signals };
}

/**
 * The Format Signals of the window: outlier reels grouped by hook pattern, own
 * niche and foreign niche kept apart. Pure over the corpus the caller hands in.
 */
export function buildFormatSignals(
  signals: RankedSignal[],
  creators: Creator[],
  options: FormatSignalOptions = {},
): { own: FormatSignalGroup; foreign: FormatSignalGroup } {
  const now = options.now ?? Date.now();
  const windowDays = options.windowDays ?? FORMAT_WINDOW_DAYS;
  const threshold = options.threshold ?? OUTLIER_THRESHOLD;
  const exampleLimit = options.exampleLimit ?? FORMAT_EXAMPLE_LIMIT;
  const weekCount = Math.max(1, Math.ceil(windowDays / 7));

  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));

  const own: RankedSignal[] = [];
  const foreign: RankedSignal[] = [];
  for (const signal of signals) {
    if (signal.format !== "reel") continue;
    const creator = creatorMap.get(signal.creatorId);
    if (!creator) continue;
    // Own uploads are read in Profile, never against the niche.
    if (isOwned(creator)) continue;
    if (now - new Date(signal.publishedAt).getTime() > windowDays * DAY) continue;
    if (!isOutlier(signal, threshold)) continue;
    (creator.foreign ? foreign : own).push(signal);
  }

  const settings: GroupSettings = { now, weekCount, exampleLimit };
  return {
    own: groupByPattern("own", own, settings),
    foreign: groupByPattern("foreign", foreign, settings),
  };
}
