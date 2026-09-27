/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as board from "../board.js";
import type * as boardAdmin from "../boardAdmin.js";
import type * as boardApify from "../boardApify.js";
import type * as boardAuth from "../boardAuth.js";
import type * as boardLease from "../boardLease.js";
import type * as boardLoad from "../boardLoad.js";
import type * as boardOps from "../boardOps.js";
import type * as boardSchema from "../boardSchema.js";
import type * as boardYoutube from "../boardYoutube.js";
import type * as boards from "../boards.js";
import type * as briefings from "../briefings.js";
import type * as creators from "../creators.js";
import type * as crons from "../crons.js";
import type * as formatReviews from "../formatReviews.js";
import type * as hashtagPosts from "../hashtagPosts.js";
import type * as hashtagSweep from "../hashtagSweep.js";
import type * as hookRuns from "../hookRuns.js";
import type * as ideas from "../ideas.js";
import type * as patterns from "../patterns.js";
import type * as refresh from "../refresh.js";
import type * as runs from "../runs.js";
import type * as scripts from "../scripts.js";
import type * as signals from "../signals.js";
import type * as slates from "../slates.js";
import type * as transcriptAnalyses from "../transcriptAnalyses.js";
import type * as transcriptDictionary from "../transcriptDictionary.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  board: typeof board;
  boardAdmin: typeof boardAdmin;
  boardApify: typeof boardApify;
  boardAuth: typeof boardAuth;
  boardLease: typeof boardLease;
  boardLoad: typeof boardLoad;
  boardOps: typeof boardOps;
  boardSchema: typeof boardSchema;
  boardYoutube: typeof boardYoutube;
  boards: typeof boards;
  briefings: typeof briefings;
  creators: typeof creators;
  crons: typeof crons;
  formatReviews: typeof formatReviews;
  hashtagPosts: typeof hashtagPosts;
  hashtagSweep: typeof hashtagSweep;
  hookRuns: typeof hookRuns;
  ideas: typeof ideas;
  patterns: typeof patterns;
  refresh: typeof refresh;
  runs: typeof runs;
  scripts: typeof scripts;
  signals: typeof signals;
  slates: typeof slates;
  transcriptAnalyses: typeof transcriptAnalyses;
  transcriptDictionary: typeof transcriptDictionary;
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
