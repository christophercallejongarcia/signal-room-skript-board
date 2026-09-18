# Architecture

Signal Room Starter is split into a product shell, stable domain contracts, replaceable adapters, and an optional local strategy bridge.

## Design goals

- useful before any provider is configured
- explicit seams between product and private intelligence
- normalized records instead of provider-shaped UI
- evidence-linked rankings instead of unexplained scores
- background refresh instead of browser-side scraping
- local-first AI bridge with a narrow request surface

## Runtime topology

![Runtime topology for the product shell, domain contracts, local bridge, and production adapters](diagrams/rendered/runtime-topology.png)

## Pages

The desk is one client shell (`components/signal-room.tsx`) with nine tabs; it opens on `/` and takes the tab from a `?tab=` parameter on mount. One creator has its own route, `/creator/<creator.id>` (`app/creator/[id]/page.tsx` → `components/creator-detail.tsx`): the stat bar and the sortable corpus table, both computed by the pure functions in `lib/creator-detail.ts`. Its links are built by `creatorPath`, which carries the tab the creator was opened from and the outlier threshold the desk was reading at, so the back link returns to that list and the outlier column limes at the same value. Both pages rank through `rankCorpus` (`lib/rank-corpus.ts`), so one reel never reads as two different outliers.

### Discover feed

The visible sorting bar separates the criterion (date, audience multiplier, or plays/views) from the `Aufsteigend` and `Absteigend` buttons. The selected direction stays active when the criterion changes, and a plain-language hint describes the resulting order. These controls reuse the existing global sort before revealing batches.

Discover filters the complete loaded corpus through `filterDiscover` and sorts all matches through `sortDiscover` before rendering. Date, plays (falling back to views), and audience multiplier each support both directions; equal values are ordered by newest publication and canonical Signal id. `components/discover-feed.tsx` reveals 12, 24, or 48 additional cards when its footer approaches the viewport, with a manual load button when automatic observation is unavailable. There is no fixed total-card limit. Network, view, date window, creator, sort, threshold, or batch-size changes reset the visible batch; changing the column count or updating a saved mark preserves it. The counter reports visible versus matching Signals, and the footer identifies completion. This is incremental rendering of the existing browser snapshot, not server pagination: it adds no provider request, storage write, credential, or new trust boundary. Existing snapshot loading and error handling remain in the shell; an empty filtered feed retains its empty state.

## Domain model

`Creator` identifies a watched public channel. `SignalRecord` is the normalized unit collected from a network. `RankedSignal` adds derived evidence and an explanation. `StrategyRequest` is a deliberately small packet sent to a strategy provider.

Raw provider payloads should be stored separately when needed for debugging or replay. Product components should never need them.

## Adapter responsibilities

### SourceConnector

- resolve stable creator identifiers
- collect a bounded time window or cursor delta
- handle provider pagination and limits
- normalize dates and metrics
- return `SignalRecord[]`

### SignalScorer

- define one documented meaning for the score
- rank a declared population and time window
- expose component evidence and a human-readable reason
- behave deterministically for the same inputs
- handle missing or zero-valued data safely

### StorageAdapter

- enforce unique canonical identities
- upsert creators and records idempotently
- store refresh cursors and job state
- separate raw evidence from derived results
- support the product's query patterns

### Daily sweep (Convex cron)

The refresh runs without anyone pressing the button. `convex/crons.ts` registers `internal.refresh.run` (`convex/refresh.ts`, `"use node"`) once per UTC hour that can be 10:00 Europe/Berlin (`0 8 * * *` and `0 9 * * *`, from `refreshCronSlots` in `lib/refresh-schedule.ts`); Convex cron specs are UTC only, so the action asks `isRefreshHour` and the slot that is not 10:00 local returns before touching Apify. The action runs the same `runRefresh` as `POST /api/refresh` over a storage built from `ctx.runQuery`/`ctx.runMutation` against this deployment's tables, so the logged `Run` is the one the Profile tab already knows; Apify is reached with the deployment's `APIFY_TOKEN` (`npx convex env set APIFY_TOKEN ...`), never from the browser. `REFRESH_CREATOR_LIMIT` and `APIFY_USD_PER_COMPUTE_UNIT` are read from the deployment's environment the same way. Two things the local refresh does are missing in the cloud: covers are not cached (there is no disk, `cacheCovers` is a no-op; the next local refresh's catch-up pass fetches them while the CDN links still resolve), and the briefing is written without angles (no Bridge is reachable; `runBriefing({ angles: false })`). A Convex action is capped at ten minutes, which bounds one sweep to roughly what the creator limit allows; a run cut off there is retried next day from the unchanged cursors. Manual test from the dashboard or the CLI: `npx convex run refresh:run '{"force":true,"creatorLimit":1}'` (`force` skips the hour guard, `creatorLimit` bounds the cost). Tracked Channels computes the next instant with `nextRefreshAt` and shows the newest logged run from `GET /api/runs`.

### Delta refresh and run log

`lib/refresh-window.ts` owns two pure functions: `refreshWindowSince` turns a creator's `lastCheckedAt` into the actor's `onlyPostsNewerThan` (the date one day before the cursor, or `"90 days"` for a first backfill) and `mergeSignals` folds incoming records into the stored corpus by `externalId`, reporting `inserted`/`updated`. `lib/collect.ts` uses them: `collectAndStore` pulls, stores, then advances `lastCheckedAt`; an actor error in either stream propagates and the cursor stays where it was, so the next run re-requests the missed window. `runRefresh` takes at most `REFRESH_CREATOR_LIMIT` Instagram creators per run (`pickRefreshBatch` in `lib/run-cost.ts`: never-checked first, then the stalest `lastCheckedAt`), records failures per creator without stopping, and writes one `Run` (`status`, timings, counts, `creatorsSkipped`, `errors[]`, `usage`) through `StorageAdapter.saveRun`; creators past the limit keep their cursor, the run ends `partial`, and the next run picks them up first. `runBackfill` does the same for the first import from `POST /api/creators`. If both actor streams fail, the error names both. `POST /api/refresh` returns the counts plus `errors`; `GET /api/runs` serves the last ten plus the running month's total (`monthUsage`) for the Profile tab. `recordsAdded` counts rows the storage actually inserted, not rows the actor returned.

The transcript pass in `runRefresh` marks its selected reels `pending` before the actor call and `failed` with a bounded cause when the actor errors. `TranscriptCount` records `added`, `silent`, `missing` and `failed`; every assigned status stays out of the automatic batch. A pending attempt is recoverable after `TRANSCRIPT_PENDING_TIMEOUT_MINUTES` (10 by default), as decided by `isPendingTranscriptExpired` in `lib/transcripts.ts`. The legacy repair removes only empty `silent` and `missing` statuses, through the internal Convex mutation `signals:resetLegacyTranscriptStatuses` or on file-store load.

The manual transcript route `POST /api/signals/transcribe` calls `runTranscript` for one Reel. `claimTranscript` atomically rejects a fresh pending or ready Signal, increments the attempt count, and allows an expired pending or failed, silent, or missing Signal to retry. The actor result is written through `patchTranscript`, which cannot overwrite metrics or saved marks, and every attempt gets its own `Run` with `kind: "transcript"`, `transcriptSignalId`, transcript counts, and usage. The file store serializes the claim; the Convex mutation supplies the same transaction boundary.

Every finished Reel transcript is idempotently queued for content analysis by text hash and analysis version. `POST /api/transcript-analyses` exposes bounded catch-up and explicit local-worker commands; one catch-up request checks at most 1,000 finished Reels in the storage snapshot's stable order and returns the last inspected canonical Signal ID as `nextCursor` when another page remains. A subsequent request over that snapshot passes the value as `cursor`; an unknown cursor is rejected instead of restarting the scan. Cloud writes only queue work and never wait for the localhost Bridge. The worker claims jobs with an expiry, analyzes bounded chunks with absolute source positions, validates every literal quote, and rejects a late result when the selected original or working copy changed. Complete and partial results retain their chunk coverage. The Reel view shows queued, running, failed, complete, and stale evidence with PAS or BBB (Behaupten, Begründen, Beispiel), exact character ranges, and only uniquely supported segment timecodes.

`POST /api/signals/transcript` sends the stored original transcript to the local Bridge's `/v1/transcript-corrections` endpoint. The Bridge returns only bounded, structured recognition-error suggestions whose `original` must occur literally in the source. The API stores proposed corrections and materializes a working copy from the original plus accepted corrections; accept, edit, and reject all recompute that copy. `hookOf` reads the working copy first, so the Hooks board, Format Signals, Format-Review, and evidence packet consume the reviewed wording. A new transcript Actor result clears the working copy and correction decisions.

The personal transcript dictionary lives in `transcriptDictionary` in Convex and in the ignored file store fallback. It stores only bounded `wrong`, `right` and `createdAt` values, merges one current mapping per wrong transcription, and exposes list/add/remove through `StorageAdapter`. When corrections are suggested, literal dictionary hits are persisted as accepted, Reel-local `dictionary` corrections before the Bridge call. The Bridge receives the bounded dictionary as context; a response that maps a known `wrong` text to another `right` value is dropped. Rejecting that correction changes the Reel's correction layer only and leaves the dictionary entry available for other Reels.

Cost guard: the Apify client (`lib/adapters/sources/apify-client.ts`) starts a run with `POST /acts/{id}/runs?waitForFinish=60`, polls `GET /actor-runs/{id}` until the status is terminal, then reads the default dataset. Only that Run object carries `stats.computeUnits` and `usageTotalUsd`; the run-sync endpoints return the OUTPUT record instead. `usageFromActorRun` reads the two figures (a missing dollar total is estimated from compute units times `APIFY_USD_PER_COMPUTE_UNIT`), `sumUsage`/`addUsage` add them up per creator and per run, and an actor run without any figure counts in `usage.unreported` so the run reads unknown rather than free. Runs logged before the guard have no `usage` at all.

### Cover cache

`lib/adapters/storage/cover-cache.ts` keeps one image file per record under `data/covers/<externalId>.jpg` (gitignored). Instagram's CDN links are signed and expire after days, so the connector's `thumbnailUrl` is downloaded once by `collectAndStore` (`lib/collect.ts`, shared by `POST /api/creators` and `POST /api/refresh`); the refresh additionally re-scans the stored corpus for missing files, and the UI only ever renders `coverUrl` (`/api/covers/<externalId>`), never the CDN link. Writes are idempotent: a cover already on disk is not fetched again, and a failed download leaves no file so the next refresh retries it. `/api/signals` sets `coverUrl` only for records whose file exists; a record without a cached cover renders the generative placeholder. The cache is local disk in both storage modes, so a Convex deployment on another host starts with an empty cache until its own refresh runs.

### Monthly Format-Review

`lib/format-review.ts` is the pure half: `buildFormatReview` runs `buildFormatSignals` over the trailing `FORMAT_WINDOW_DAYS` (90), diffs every pattern against the patterns stored in the previous review, and adds the small accounts worth watching. The move is decided on the share of the outlier corpus, not on the raw count, and a share that held inside `SHARE_EPSILON` (one point) reads `flat`. A pattern that vanished stays in the list at zero and reads `gone`, so the review reports what was lost; it is reported once, in the review it disappeared in, and then leaves the list, because `diffPatterns` drops any pattern that stands at zero on both sides. `findRisingCreators` picks creators under `FORMAT_REVIEW_SMALL_AUDIENCE` (50k) whose outlier reel carries a named pattern, at most `FORMAT_REVIEW_RISING_LIMIT` (5), one entry per creator with their strongest reel, a shape that is new this month first. Both niches feed that list and each entry carries its `foreign` mark; the pattern diff itself stays on the own niche, so a shape that carries no own-niche outlier at all reads `new` there.

The schedule lives in Convex: `convex/crons.ts` runs `internal.formatReviews.generate` at 03:00 UTC on the first of every month. Both that mutation and `POST /api/format-reviews` go through one function, `reviewCorpus`, so the monthly pass and the manual one cannot drift apart: rank with the same `outlierScorer` the UI uses, build, diff, write one document into `formatReviews`. The cron reads only what the window covers, newest first off the `by_published` index and bounded by `MAX_SIGNALS`, so the transaction stays small and a corpus past the bound loses its oldest rows rather than the ones the review is about. `previousReview` picks the baseline as the newest stored review that is not the document this run is about to write, so a rerun on the same run date diffs against the review before it instead of against itself, and `format-review-<YYYY-MM-DD>` makes the write idempotent per run date. `GET /api/format-reviews` serves the latest one to the Format Signals tab, where it renders as "What changed" with the badge legend spelled out; `POST` is the manual pass, and the only path the file store has (ADR-0005). The stored shape (`FormatReview`, `FormatReviewPattern`, `RisingCreator`) lives in `lib/contracts.ts` with the other stored entities.

### Daily Briefing

`lib/briefing.ts` is the pure half. `selectBriefingSignals` takes the niche corpus (`withoutOwned`), keeps short form, ranks with the same `outlierScorer` every other view uses, drops everything published outside `BRIEFING_WINDOW_HOURS` (24) and cuts at `BRIEFING_LIMIT` (10). The order is `briefingScore` = Outlier × Frische: freshness runs linearly from 1 at publication down to `BRIEFING_FRESHNESS_FLOOR` (0.5) at the window edge, so the outlier stays the deciding term and freshness only settles what is close. A reel needs exactly twice the outlier to win from the edge against one just published. `buildBriefing` wraps that into the stored document: the day, the window, the distinct creators behind the items (`sources`), and `candidates`, everything the window held before the cut, so the tab can say what it left out. The item carries creator name, handle, cover fields and a bounded caption excerpt, so the list reads without a join back into `signals`.

The angle is hung on afterwards, never woven in. `runBriefing` (`lib/briefing-run.ts`) composes the document, decorates the corpus with `withCoverUrls`, hands the ranked reels to the bridge on `/v1/briefing` as an ordinary evidence packet, and `applyAngles` maps the answer onto the items positionally — the answer schema is built from the packet length, so one angle lands per reel and nothing has to be matched back by title. A bridge that is down, logged out or slow is caught inside `runBriefing`: the briefing is written without angles and `angles: false` tells the tab to say so. Every `POST /api/refresh` runs the pass after the collection it just logged, so a refresh always leaves a briefing behind; `POST /api/briefings` is the same pass on demand, and the only path the file store has (ADR-0005). The id is `briefing-<YYYY-MM-DD>`, so a second refresh on the same day rewrites one document instead of stacking mornings. `GET /api/briefings` serves the newest `BRIEFING_HISTORY` (14) to the tab, which reads the first and lets older days be picked. With an empty store the tab runs the same `buildBriefing` over the demo fixtures in the browser, angle-less and unwritten, so it renders before the first refresh.

### Daily Slate

The Produktions-Slate is the briefing's sibling: where the briefing lists the reels of the window, the slate lists what to make of them. `lib/slate.ts` is the pure half. `slateSources` reuses `selectBriefingSignals` for the same window and cut (at `SLATE_SOURCE_LIMIT`, 12) and drops any reel without a title or handle, because the packet the bridge accepts must be the packet the answer's positions point into. `parseSlateAnswer` validates what came back: exactly the number of starts the run asked for, each with a bounded pitch and topic and a `source` that is a 1-based integer into the packet, resolved to `sourceSignalId`, handle, title, url, outlier and plays. Positions instead of titles, because two reels can share a title and the answer must never be matched back by text. A short list or a position outside the packet refuses the whole answer, like a short list of angles does. `replaceStart` puts one regenerated start at its position and leaves the others untouched, `withDirection` stores the direction for the next run, `ideaFromStart` turns one start into an Idea with its source Signal and stamps the Idea's id on the start so it is not turned twice.

`lib/slate-run.ts` is the run. `runSlate` reads the newest stored slate first: if it is today's and `force` is not set, it is handed back as it is, so a second refresh on the same day never wipes out a regenerated start or an Idea the first one led to. The direction comes from that newest slate, today's or yesterday's, which is how "for the next run" is kept: typed once, applied until changed, and recorded as `directionApplied`. The packet goes to the bridge on `/v1/slate` (`validateSlateRequest`, `slateOutputSchema(count, sourceCount)`, `buildSlatePrompt` in `bridge/request.mjs`), which numbers the reels in the prompt and asks for `count` starts. A window without a reel writes an empty slate and never calls the bridge. Unlike an angle, the slate is the document itself, so a bridge that is down, logged out or answers badly writes nothing and the caller hears why. `regenerateStart` reads the packet from the window the slate was composed for, sends the other pitches as `taken` and the slate's direction, asks for one start and writes it back at its position.

`POST /api/refresh` runs the pass after the briefing and logs a failure without failing the refresh; `POST /api/slates` is the same pass on demand (`{ force: true }` rebuilds the day), `PATCH /api/slates` stores the direction, `POST /api/slates/regenerate` writes one position anew, `POST /api/slates/ideas` captures one start as an Idea (Idea first, slate second, so a slate that fails to save still leaves the Idea). `GET /api/slates` serves the newest `SLATE_HISTORY` (14). The Convex cron writes no slate, since no bridge is reachable from the cloud; the local refresh and the button under the briefing do. The tab renders the slate as a panel under the briefing list with the day picker, the ten rows (topic label, pitch, source reel, regenerate, create idea) and the direction form; in demo mode it only says that the slate reads the stored corpus.

### Cover Lab

`lib/cover-lab.ts` owns the Cover-Lab contract: `reel` is 4:5 with text in the upper third and the bottom controls zone clear; `youtube` is 16:9 with text in a side column and the lower-right duration zone clear. `parseCoverRequest` is the one browser request parser, and the Bridge validates the same two formats before it builds its prompt. A developed Idea can hold at most one current board per format, each with exactly three packages (`textOverlay`, `imageIdea`, `colorWorld`, and the image prompt). `upsertCoverBoard` replaces only the selected format, so a YouTube run leaves an existing Reel board in place; `replaceCoverPackage` changes one package without disturbing its siblings.

`POST /api/covers` sends the Idea's storyboard and selected format/treatment to `/v1/covers`. The local Bridge first asks Codex for three structured package directions, then renders each image with the built-in GPT Image capability in an isolated temporary workspace. The app validates the returned raster bytes and writes them below `data/covers/ideas/<idea>/<format>/<package>.png` or the corresponding supported extension. `POST /api/covers/regenerate` sends one existing package and replaces only that package. The stored Idea carries the relative image path and local route, and the Ideas view displays both format boards together. A missing Codex login returns the same actionable `codex login` message as the other Bridge routes.

### Strategy-Provider and the evidence packet

`lib/strategy-evidence.ts` builds one evidence packet from the stored corpus: reels only, published inside `STRATEGY_EVIDENCE_WINDOW_DAYS` (30), at or above `OUTLIER_THRESHOLD` (the same Schwelle Discover uses), sorted by outlier and then plays, capped at `STRATEGY_EVIDENCE_LIMIT` (10). Every item carries title, creator handle, a whitespace-collapsed caption excerpt, plays and the outlier factor rounded to one decimal. All three knobs live in `lib/config.ts`, next to `STRATEGY_GOAL` and `STRATEGY_AUDIENCE`, which read `NEXT_PUBLIC_STRATEGY_GOAL` and `NEXT_PUBLIC_STRATEGY_AUDIENCE` so your positioning stays in `.env.local` and out of the repo. Develop, Hooks and other Bridge-backed workflows build from this stored corpus; demo data never enters a provider packet.

The packet goes to the local bridge (`bridge/server.mjs`, ADR-0004), which validates and re-clamps it (`bridge/request.mjs`), builds a prompt in the CONTEXT.md vocabulary that asks for German output, and runs it through the Codex SDK against a fixed output schema. `bridge/auth.mjs` reports whether Codex can run at all: `CODEX_API_KEY`, otherwise `$CODEX_HOME/auth.json` (default `~/.codex`). `GET /health` returns `{ ok, service, codex }`; a request while logged out fails fast with 503 instead of spawning Codex.

`Capture idea` writes an Idea to the `ideas` table through `POST /api/ideas`, and so does `Create idea` on a Discover or Briefing card, which attaches the source Signal as `sourceSignalId` and `sourceCreator`. The Ideas tab is an Inbox for capture, Develop, Drop and links into Script work. `lib/ideas.ts` holds the whole idea state machine as pure functions: the six production stages in order (`IDEA_STAGES`: `captured`, `developing`, `packaging`, `scripting`, `producing`, `published`) plus `dropped`, the allowed moves in `canTransition`, `moveIdea` for the manual push, and `countByStage` for the counter bar above the list. The Ideas tab moves an Idea by hand through `PATCH /api/ideas`; forbidden moves answer 409 with the preserved reason. Ideas stored before the pipeline are mapped by `legacyStage` (`developed -> developing`, `produced -> producing`).

### Script studio

The Lektorat runtime rules are versioned under `.agents/skills/slop-check`: the Regex script and the three German reference files travel with every checkout. The Bridge prefers these repository files over the optional machine-local fallback; `SLOP_CHECK_SKILL_PATH` remains an explicit override. CI and local tests use Node.js 22 (minimum 22.18) for direct TypeScript imports.

Scripts are separate production objects in `scripts`, linked to their Idea through `ideaId` and to the optional source Reel and additional evidence through canonical Signal ids. `lib/scripts.ts` owns the four-status state machine, section invariant, Hook-Option selection and revision behavior. Manual moves are limited to `draft -> review`, `review -> draft`, `review -> approved` and `approved -> draft`; the last move increments the revision. `hook-selection -> draft` is reserved for a successful Draft run. `approved` is locked until that explicit reopening.

`StorageAdapter` exposes `listScripts`, `getScript`, `saveScript`, `patchScript`, `claimScriptRun`, `settleScriptRun` and `moveScript`. The file adapter keeps the same shape in the ignored `data/store.json`; Convex stores the bounded nested contract in `scripts` with an index on `ideaId`. `PATCH /api/scripts/<id>` validates a complete section list, applies framework, Hook-Option and evidence changes, and carries status moves in one transaction. `renderScriptReadingView` derives the Leseansicht with a source-section index, so both editor columns write to the same list and never reverse-translate joined text. A changed section list advances the revision once. A run claim and a stale-settle check prevent a late Bridge answer from replacing newer Script data. `GET /api/scripts` feeds the Scripts tab, while `GET /api/scripts/<id>` feeds the detail page. Empty-store demo fixtures are served without writing them into the store.

`POST /api/scripts/<id>/draft` accepts one stored Hook-Option and the selected framework only from `hook-selection` or `draft`. `runScriptDraft` rebuilds the bounded source and evidence packet from the Script's canonical Signal ids, claims `runId` with collision rejection, and calls `/v1/script-draft`. `parseScriptDraftAnswer` requires one Hook, two to five Beats, optional Transitions and one CTA. The answer must start with the selected Hook verbatim and end with the CTA. It then compares every generated sentence from eight words against normalized supplied transcripts and captions. A match names the copied sentence and releases the claim without changing the Script. A successful first run moves to `draft`; every run replaces the whole section list and advances the revision once. Empty-store demo mode returns fixed synthetic sections without calling the Bridge.

The editor's Lektorat pass is review-only. `runScriptLint` sends bounded, ordered sections with generated `section-<n>` ids to `/v1/script-lint`, where the Bridge runs the installed `.agents/skills/slop-check` Regex stage and gives the Modell stage the pattern catalogue and false-positive rules. `parseScriptLintResponse` checks the untrusted answer again: the section id must be in the accepted packet, `original` must occur literally in that section, and every line and the list are capped. The run claims the Script through `runId`, leaves the section list untouched, and settles by releasing the claim even when the Bridge or parser fails. `applyScriptLintSuggestion` is the human-only write path; it replaces the literal occurrence and advances the Script revision through the existing `PATCH /api/scripts/<id>` contract. Empty-store demo Scripts show fixed suggestions without a Bridge call.

`POST /api/scripts/<id>/storyboard` is the only current Storyboard write path. It accepts only an `approved` Script whose `approvedRevision` equals its current revision, claims the Script through `runId`, then checks that gate again on the claimed row before sending the bounded Script sections and its canonical evidence Reels to the existing `/v1/storyboard` Bridge route. A second run conflicts, while success and error both release the claim. `parseScriptStoryboardAnswer` overwrites the returned Hook with the Script Hook, requires exactly three Beats, and rejects any normalized equality among Hook, Beat details, CTA and individual Caption lines. The storage adapter loads the linked Idea by canonical id and atomically patches only Storyboard, Forecast and their timestamps, so a concurrent stage or cover write is retained. The stored Storyboard records `scriptId` and `scriptRevision`; one without `scriptId` remains a visible Legacy-Storyboard, and a later approved revision marks it stale. The Forecast remains beside the Storyboard and is derived locally from Bridge-named comparable Reels. Demo mode returns a fixed synthetic Storyboard without calling the Bridge only when Scripts, Ideas, Signals and Creators are all empty.

### Instagram Trend Radar

`lib/adapters/sources/apify-instagram-hashtags.ts` is the only source for Trend Radar. It sends the bounded configured list (`INSTAGRAM_HASHTAGS`, overridable server-side with `INSTAGRAM_HASHTAGS`) to `apify~instagram-scraper` as `resultsType: "posts"`, maps vendor fields into `HashtagPost`, rejects non-German captions, and assigns a topic through the ordered keyword rules in `lib/trend-radar.ts`. It never imports or calls an X connector. Posts are stored separately from creator Signals in `hashtagPosts`, keyed by Instagram shortcode, so the same post found through two hashtags is written once.

`runHashtagSweep` writes one `Run` with `kind: "hashtag-sweep"`. The result is committed only when Apify reports a verifiable dollar cost at or below `INSTAGRAM_HASHTAG_COST_LIMIT_USD`; an unreported or over-limit run is logged as failed and its posts are not stored. The Convex cron in `convex/crons.ts` and the human-triggered `POST /api/trends` use that same function. `buildTrendRadar` compares the current and previous seven-day windows, averages bounded post/play movement into Momentum, and multiplies positive Momentum by the uncovered share of tracked, non-owned Instagram creators for Opportunity. The UI shows the deltas, coverage denominator, lead post, and plain-language reason beside every score.

`Develop idea` runs server-side through `POST /api/ideas/develop`. The route selects the same 30-day, ten-Reel evidence window as the other strategy surfaces, always adds the Idea's source Reel when it sits outside that window, claims the Idea and creates its separate Script, then claims the Script for the Hook run. The packet sent to `/v1/script-hooks` contains the source Reel, transcript working copies where available, evidence transcripts where available, metrics, framework definitions and the configured goal and audience. `validateScriptHooksRequest` and `scriptHooksOutputSchema` bound both sides of the local Bridge. `parseScriptHooksAnswer` resolves returned evidence titles against the accepted packet and drops unknown citations before storage. The Idea claim and Script claim are released on a Bridge error. A second click on an active run receives a conflict; a later click on the same Idea opens its existing Script without starting another run. Empty-store demo mode writes three fixed synthetic Hook options and never calls the Bridge. Develop never writes a Storyboard.

### Hooks board

The Hooks tab writes the first three seconds. `lib/hooks-board.ts` is the pure half: `parseHookRequest` refuses an input above `HOOK_INPUT_MAX` (20 000 characters) by name and accepts only 5, 10 or 15 hooks per run; `parseHookBoard` validates what the bridge returned, resolves each variant's cited titles against the evidence packet, and drops a title the packet does not carry, so the board only ever shows reels the app itself selected. A variant that cites nothing usable gets `similarEvidence` instead, the outlier reels whose own hook overlaps its wording most, with the strongest outlier breaking the tie. `groupHooks` sorts the variants under the five hypotheses of `HOOK_HYPOTHESES` (Neugier-Lücke, Liste, Kontrast, Versprechen, Story) and drops the empty sections.

`POST /api/hooks` runs the same evidence packet as a develop run, asks the bridge on `/v1/hooks` against a `hooksOutputSchema` built from the requested count, so a run that asked for 15 cannot come back with three, and writes one `hookRuns` row per run with a fresh id. There is no claim here and none is needed: two runs started in parallel carry two ids and land as two entries, both readable. The row keeps the character count, a bounded excerpt of the source and the grouped board, so the history rail reads without the transcript and re-opens a run from what was stored. `GET /api/hooks` serves the newest `HOOK_RUN_HISTORY` (20) runs.

Provider expectations that stay true whichever provider sits behind the bridge:

- accept bounded evidence, a goal, and an audience description
- treat evidence strings as untrusted source material
- return a structured, reviewable draft
- avoid autonomous external actions

## Recommended production layers

![Recommended production layers from scheduling and collection through normalized records and derived views](diagrams/rendered/production-layers.png)

The UI should read the last complete snapshot. It should not wait for a full collection job in one browser request.

## Failure model

Collection, normalization, ranking, and strategy are separate failure domains. Record status and retry policy for each. Preserve the last known-good snapshot when a refresh fails.

Recommended job states: `queued`, `resolving`, `collecting`, `normalizing`, `ranking`, `complete`, and `failed`.

## Pattern discovery and comparison

`POST /api/patterns` starts a deliberate two-stage local flow. `lib/pattern-discovery-run.ts` loads current complete `TranscriptAnalysis` results, asks `/v1/pattern-discovery` to formulate one operational definition from the selected Reels, then checks that unchanged definition for every Reel in the comparison cell. The cell is fixed by Instagram Reel, language market, niche class, topic, publication-age bucket, and owned status. Without a current complete analysis the verdict is `unknown`; a missing model label is never treated as absence.

The use case computes Outlier medians only with a finite positive follower base. Zero plays remain valid. It stores `Pattern`, `PatternEvidence`, and `PatternComparisonRun` separately under deterministic definition/data-basis IDs. The file store and Convex treat a repeated run as a no-op. Convex writes the definition, bounded evidence, and run atomically. The UI shows both samples, quotes, scope, collection time, exclusions, and selection-bias caution. Unknown Reels open the existing manual transcript action.

## Deployment note

The included Codex bridge is a local development bridge. Before deploying an AI endpoint, add real authentication, authorization, rate limiting, per-user isolation, audit logging, abuse controls, and a deployment-specific sandbox policy.

Pattern comparisons select at most 20 matching Reels in deterministic publication/id order and show the selected/eligible count. Current analysis IDs are read directly. Both presence and absence require literal transcript evidence with matching positions. Thresholds can be set through PATTERN_MIN_POSITIVE_REELS, PATTERN_MIN_POSITIVE_CREATORS and PATTERN_MIN_NEGATIVE_REELS (positive integers up to 20).
