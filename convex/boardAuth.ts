import { ConvexError } from "convex/values";
import { SUPPORTED_OPS_VERSIONS } from "../lib/board/versions";
import { env, type MutationCtx, type QueryCtx } from "./_generated/server";
import { BOARD_SCHEMA_VERSION } from "./boardSchema";

/**
 * Shared guards for every board function (PLAN.md points 9b, 9c, 9d, 13).
 * Errors are `ConvexError({ kind, message })` so Next can map them to HTTP
 * status codes even on a production deployment.
 */

export type BoardErrorKind = "unauthorized" | "version" | "readonly" | "draining" | "restoring" | "epoch" | "not-found" | "conflict" | "invalid" | "too-large" | "lease";

export function boardError(kind: BoardErrorKind, message: string, extra: Record<string, string | number | boolean> = {}): ConvexError<Record<string, string | number | boolean>> {
  return new ConvexError({ kind, message, ...extra });
}

/** Every board function takes `token`, checked against the deployment's BOARD_ACCESS_TOKEN (point 13). */
export function requireToken(token: string) {
  const expected = env.BOARD_ACCESS_TOKEN;
  if (!expected || expected.length < 32 || token.length !== expected.length) throw boardError("unauthorized", "Board-Zugriff verweigert.");
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  if (diff !== 0) throw boardError("unauthorized", "Board-Zugriff verweigert.");
}

export type BoardConfigView = { mode: "open" | "draining" | "readonly" | "restoring"; schemaVersion: number; restoreEpoch: number; apifyEnabled: boolean };

const DEFAULT_CONFIG: BoardConfigView = { mode: "open", schemaVersion: BOARD_SCHEMA_VERSION, restoreEpoch: 1, apifyEnabled: true };

export async function readConfig(ctx: QueryCtx | MutationCtx): Promise<BoardConfigView> {
  const config = await ctx.db
    .query("boardConfig")
    .withIndex("by_key", (q) => q.eq("key", "config"))
    .unique();
  return config ? { mode: config.mode, schemaVersion: config.schemaVersion, restoreEpoch: config.restoreEpoch, apifyEnabled: config.apifyEnabled } : DEFAULT_CONFIG;
}

/**
 * Gate for every write. `kind: "new"` is fresh user work (ops, new runs, Apify,
 * export commits); `kind: "finish"` completes work already running (renewRun,
 * appendRun, finishRun, journal replay, abort). Checked before anything is applied.
 */
export async function assertWritable(
  ctx: MutationCtx,
  { opsVersion, restoreEpoch, kind }: { opsVersion: number; restoreEpoch?: number; kind: "new" | "finish" },
): Promise<BoardConfigView> {
  if (!SUPPORTED_OPS_VERSIONS.includes(opsVersion)) throw boardError("version", "Board neu laden: Die Seite ist älter als der Server.", { opsVersion });
  const config = await readConfig(ctx);
  if (config.mode === "restoring") throw boardError("restoring", "Das Board wird gerade wiederhergestellt. Bitte später erneut versuchen.");
  if (restoreEpoch !== undefined && restoreEpoch !== config.restoreEpoch) {
    throw boardError("epoch", "Dieser Stand stammt von vor einer Wiederherstellung und wird als Konfliktkopie angeboten.", { restoreEpoch: config.restoreEpoch });
  }
  if (kind === "new" && config.mode === "readonly") throw boardError("readonly", "Das Board ist schreibgeschützt.");
  if (kind === "new" && config.mode === "draining") throw boardError("draining", "Das Board nimmt gerade keine neuen Änderungen an (Drain).");
  return config;
}
