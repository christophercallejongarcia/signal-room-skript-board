/**
 * IDs in Poppy's scheme (PLAN.md point 16): boards `<adjective>-<noun>-<5 chars>`,
 * nodes `<type>-<adjective>-<noun>-<5 chars>`, edges `xy-edge__<source>connector-<target>chat-connector`.
 * Plain ASCII so IDs survive URLs, file names and Convex indexes unchanged.
 */

const ADJECTIVES = [
  "amber", "bold", "brave", "bright", "calm", "clever", "cosmic", "crisp", "curious", "daring",
  "eager", "early", "fancy", "fast", "fresh", "gentle", "golden", "grand", "happy", "honest",
  "jolly", "keen", "kind", "late", "lively", "long", "lucky", "merry", "mighty", "misty",
  "noble", "odd", "proud", "quick", "quiet", "rapid", "rare", "royal", "rustic", "shiny",
  "silent", "silver", "smart", "snowy", "solid", "spicy", "steady", "sunny", "swift", "tidy",
  "vivid", "warm", "wild", "wise", "witty", "young", "zesty", "wonderful", "velvet", "polar",
];

const NOUNS = [
  "anchor", "badger", "beacon", "birch", "canyon", "cedar", "comet", "coral", "crane", "dune",
  "ember", "falcon", "fern", "firefly", "forest", "fox", "garden", "glacier", "harbor", "hawk",
  "heron", "island", "lagoon", "lantern", "lark", "maple", "meadow", "meteor", "moss", "nebula",
  "oak", "orbit", "otter", "owl", "panda", "pebble", "pine", "planet", "prairie", "quartz",
  "raven", "reef", "river", "robin", "sage", "shore", "sparrow", "spruce", "stone", "summit",
  "thunder", "tiger", "trail", "tulip", "valley", "willow", "wolf", "wren", "yarrow", "zephyr",
];

const TITLE_ADJECTIVES = ["Kupfernes", "Stilles", "Mutiges", "Goldenes", "Flinkes", "Helles", "Wildes", "Kluges", "Warmes", "Frisches", "Ruhiges", "Leuchtendes"];
const TITLE_NOUNS = ["Kaninchen", "Eichhörnchen", "Rotkehlchen", "Murmeltier", "Glühwürmchen", "Seepferdchen", "Wiesel", "Reh", "Fohlen", "Kätzchen", "Lamm", "Faultier"];

const SUFFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export const NODE_TYPES = ["youtubeNode", "textNode", "groupNode", "chatNode"] as const;
export type NodeType = (typeof NODE_TYPES)[number];
const NODE_PREFIX: Record<NodeType, string> = { youtubeNode: "youtube", textNode: "text", groupNode: "group", chatNode: "chat" };

type Random = () => number;

function pick<T>(list: readonly T[], random: Random): T {
  return list[Math.floor(random() * list.length) % list.length];
}

/** Uniform random in [0, 1) from Web Crypto; injectable for deterministic tests. */
export function cryptoRandom(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

function suffix(random: Random, length = 5): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += pick(SUFFIX_ALPHABET.split(""), random);
  return out;
}

export function newBoardId(random: Random = cryptoRandom): string {
  return `${pick(ADJECTIVES, random)}-${pick(NOUNS, random)}-${suffix(random)}`;
}

export function newNodeId(type: NodeType, random: Random = cryptoRandom): string {
  return `${NODE_PREFIX[type]}-${pick(ADJECTIVES, random)}-${pick(NOUNS, random)}-${suffix(random)}`;
}

export function edgeId(source: string, target: string): string {
  return `xy-edge__${source}connector-${target}chat-connector`;
}

export function newBoardTitle(random: Random = cryptoRandom): string {
  return `${pick(TITLE_ADJECTIVES, random)} ${pick(TITLE_NOUNS, random)}`;
}

/** Opaque IDs for runs, requests, sessions, ops. */
export function newOpaqueId(prefix: string, random: Random = cryptoRandom): string {
  return `${prefix}-${suffix(random, 12)}`;
}

export const BOARD_ID_PATTERN = /^[a-z]+-[a-z]+-[A-Za-z0-9]{5}$/;
export const NODE_ID_PATTERN = /^(youtube|text|group|chat)-[a-z]+-[a-z]+-[A-Za-z0-9]{5}$/;

export function isBoardId(value: unknown): value is string {
  return typeof value === "string" && BOARD_ID_PATTERN.test(value);
}

export function isNodeId(value: unknown): value is string {
  return typeof value === "string" && NODE_ID_PATTERN.test(value);
}

export function nodeTypeOfId(id: string): NodeType | null {
  const prefix = id.split("-")[0];
  const entry = (Object.entries(NODE_PREFIX) as [NodeType, string][]).find(([, value]) => value === prefix);
  return entry ? entry[0] : null;
}
