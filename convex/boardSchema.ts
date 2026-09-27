import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Skript-Board tables (PLAN.md section C). Kept apart from the Signal Room
 * tables so `schema.ts` only grows by one spread (additive, point 4).
 */

export const BOARD_SCHEMA_VERSION = 1;

export const boardModeValidator = v.union(v.literal("open"), v.literal("draining"), v.literal("readonly"), v.literal("restoring"));

/** Singleton switch board (`key: "config"`) plus short-lived probe rows written by `board:doctor`. */
export const boardConfigFields = {
  key: v.string(),
  mode: boardModeValidator,
  schemaVersion: v.number(),
  restoreEpoch: v.number(),
  apifyEnabled: v.boolean(),
  drainingSince: v.optional(v.number()),
  updatedAt: v.number(),
};

export const boardTables = {
  boardConfig: defineTable(boardConfigFields).index("by_key", ["key"]),
};
