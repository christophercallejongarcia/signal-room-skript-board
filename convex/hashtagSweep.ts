"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { hashtagStorageOver } from "../lib/adapters/storage/convex";
import { runHashtagSweep } from "../lib/hashtag-sweep";

/** Daily Instagram hashtag collection. It has its own cost-guarded Run entry. */
export const run = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const storage = hashtagStorageOver({
      query: (ref, args) => ctx.runQuery(ref, args),
      mutation: (ref, args) => ctx.runMutation(ref, args),
    });
    await runHashtagSweep({ storage });
    return null;
  },
});

