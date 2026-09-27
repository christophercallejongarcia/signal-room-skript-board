import { v } from "convex/values";
import { SUPPORTED_OPS_VERSIONS } from "../lib/board/versions";
import { env, query } from "./_generated/server";
import { readConfig, requireToken } from "./boardAuth";
import { BOARD_SCHEMA_VERSION, boardModeValidator } from "./boardSchema";

/** Version of the board function set in this deployment, reported by health (point 9b). */
export const BOARD_FUNCTIONS_VERSION = "2026-09-27.1";

/** Health contract of the Convex layer (PLAN.md points 9b, 53). */
export const boardHealth = query({
  args: { token: v.string() },
  returns: v.object({
    ok: v.boolean(),
    layer: v.literal("convex"),
    deployment: v.string(),
    build: v.string(),
    schemaVersion: v.number(),
    configSchemaVersion: v.number(),
    supportedOpsVersions: v.array(v.number()),
    mode: boardModeValidator,
    restoreEpoch: v.number(),
    apifyEnabled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireToken(args.token);
    const config = await readConfig(ctx);
    return {
      ok: true,
      layer: "convex" as const,
      deployment: (env.CONVEX_CLOUD_URL as string | undefined) ?? "unbekannt",
      build: BOARD_FUNCTIONS_VERSION,
      schemaVersion: BOARD_SCHEMA_VERSION,
      configSchemaVersion: config.schemaVersion,
      supportedOpsVersions: [...SUPPORTED_OPS_VERSIONS],
      mode: config.mode,
      restoreEpoch: config.restoreEpoch,
      apifyEnabled: config.apifyEnabled,
    };
  },
});
