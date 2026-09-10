import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { transcriptDictionaryFields } from "./schema";

const MAX_DICTIONARY_ENTRIES = 500;
const MAX_DICTIONARY_TEXT = 120;

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_DICTIONARY_TEXT);
}

function withoutSystemFields(row: { _id: unknown; _creationTime: number; wrong: string; right: string; createdAt: string }) {
  const { _id, _creationTime, ...entry } = row;
  return entry;
}

/** Newest first, bounded because dictionary text is sent as Bridge context. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("transcriptDictionary")
      .withIndex("by_createdAt")
      .order("desc")
      .take(Math.min(Math.max(limit ?? MAX_DICTIONARY_ENTRIES, 1), MAX_DICTIONARY_ENTRIES));
    return rows.map(withoutSystemFields);
  },
});

/** Upserts one mapping by its wrong transcription and removes duplicate rows for that key. */
export const add = mutation({
  args: { entry: v.object(transcriptDictionaryFields) },
  handler: async (ctx, { entry }) => {
    const normalized = {
      wrong: normalizeText(entry.wrong),
      right: normalizeText(entry.right),
      createdAt: entry.createdAt.trim(),
    };
    if (!normalized.wrong || !normalized.right || normalized.wrong === normalized.right || !normalized.createdAt) {
      throw new Error("Dictionary entries need different, non-empty wrong and right text.");
    }
    const rows = await ctx.db
      .query("transcriptDictionary")
      .withIndex("by_wrong", (q) => q.eq("wrong", normalized.wrong))
      .take(100);
    const existing = rows[0];
    if (existing) {
      for (const duplicate of rows.slice(1)) await ctx.db.delete(duplicate._id);
      await ctx.db.replace(existing._id, normalized);
      return normalized;
    }
    await ctx.db.insert("transcriptDictionary", normalized);
    return normalized;
  },
});

/** Removes the exact personal mapping. The Reel correction itself is unchanged. */
export const remove = mutation({
  args: { wrong: v.string(), right: v.string() },
  handler: async (ctx, { wrong, right }) => {
    const rows = await ctx.db
      .query("transcriptDictionary")
      .withIndex("by_wrong", (q) => q.eq("wrong", wrong))
      .take(100);
    const matches = rows.filter((row) => row.right === right);
    for (const match of matches) await ctx.db.delete(match._id);
    return matches[0] ? withoutSystemFields(matches[0]) : null;
  },
});
