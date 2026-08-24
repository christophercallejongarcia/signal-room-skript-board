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

### Delta refresh and run log

`lib/refresh-window.ts` owns two pure functions: `refreshWindowSince` turns a creator's `lastCheckedAt` into the actor's `onlyPostsNewerThan` (the date one day before the cursor, or `"90 days"` for a first backfill) and `mergeSignals` folds incoming records into the stored corpus by `externalId`, reporting `inserted`/`updated`. `lib/collect.ts` uses them: `collectAndStore` pulls, stores, then advances `lastCheckedAt`; an actor error in either stream propagates and the cursor stays where it was, so the next run re-requests the missed window. `runRefresh` loops every Instagram creator, records failures per creator without stopping, and writes one `Run` (`status`, timings, counts, `errors[]`) through `StorageAdapter.saveRun`; `runBackfill` does the same for the first import from `POST /api/creators`. If both actor streams fail, the error names both. `POST /api/refresh` returns the counts plus `errors`; `GET /api/runs` serves the last ten for the Profile tab. `recordsAdded` counts rows the storage actually inserted, not rows the actor returned.

### Cover cache

`lib/adapters/storage/cover-cache.ts` keeps one image file per record under `data/covers/<externalId>.jpg` (gitignored). Instagram's CDN links are signed and expire after days, so the connector's `thumbnailUrl` is downloaded once by `collectAndStore` (`lib/collect.ts`, shared by `POST /api/creators` and `POST /api/refresh`); the refresh additionally re-scans the stored corpus for missing files, and the UI only ever renders `coverUrl` (`/api/covers/<externalId>`), never the CDN link. Writes are idempotent: a cover already on disk is not fetched again, and a failed download leaves no file so the next refresh retries it. `/api/signals` sets `coverUrl` only for records whose file exists; a record without a cached cover renders the generative placeholder. The cache is local disk in both storage modes, so a Convex deployment on another host starts with an empty cache until its own refresh runs.

### StrategyProvider

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

## Deployment note

The included Codex bridge is a local development bridge. Before deploying an AI endpoint, add real authentication, authorization, rate limiting, per-user isolation, audit logging, abuse controls, and a deployment-specific sandbox policy.
