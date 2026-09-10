/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as briefings from "../briefings.js";
import type * as creators from "../creators.js";
import type * as crons from "../crons.js";
import type * as formatReviews from "../formatReviews.js";
import type * as hashtagPosts from "../hashtagPosts.js";
import type * as hashtagSweep from "../hashtagSweep.js";
import type * as hookRuns from "../hookRuns.js";
import type * as ideas from "../ideas.js";
import type * as refresh from "../refresh.js";
import type * as runs from "../runs.js";
import type * as scripts from "../scripts.js";
import type * as signals from "../signals.js";
import type * as slates from "../slates.js";
import type * as transcriptDictionary from "../transcriptDictionary.js";
import type * as transcriptAnalyses from "../transcriptAnalyses.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  briefings: typeof briefings;
  creators: typeof creators;
  crons: typeof crons;
  formatReviews: typeof formatReviews;
  hashtagPosts: typeof hashtagPosts;
  hashtagSweep: typeof hashtagSweep;
  hookRuns: typeof hookRuns;
  ideas: typeof ideas;
  refresh: typeof refresh;
  runs: typeof runs;
  scripts: typeof scripts;
  signals: typeof signals;
  slates: typeof slates;
  transcriptDictionary: typeof transcriptDictionary;
  transcriptAnalyses: typeof transcriptAnalyses;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
