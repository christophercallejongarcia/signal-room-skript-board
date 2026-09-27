import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    TRANSCRIPT_ANALYSIS_WORKER_TOKEN: v.optional(v.string()),
    BOARD_ACCESS_TOKEN: v.optional(v.string()),
  },
});
