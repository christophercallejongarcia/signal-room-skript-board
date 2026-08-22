# Customization Recipes

Keep demo mode working while replacing one seam at a time.

## Connect a collection provider

Create `adapters/sources/provider.ts` and implement `SourceConnector`.

Normalize these fields for each public item:

- canonical record ID
- canonical creator ID
- title or caption
- publication timestamp in UTC
- public view, like, and comment counts when available
- duration in seconds when applicable
- stable thumbnail reference
- your own topic label or an empty label to classify later

Do not pass provider response objects into React components. Provider schemas change, and that coupling spreads quickly.

### Collection acceptance checks

- the same cursor run produces no duplicates
- pagination stops at a declared bound
- deleted or private records are handled deliberately
- rate-limit responses back off instead of looping
- one failing channel does not discard successful channels
- timestamps are normalized to UTC

## Build your ranking method

Start with a written definition:

> A high score means this record is unusually useful for this workspace because ...

Then define the reference population, time window, minimum evidence, missing-data policy, and calibration process. Keep each component inspectable.

Useful tests are property-based:

- increasing the target metric should not lower the score when all else is equal
- older records should not become fresher
- zero audience or zero views should never divide by zero
- duplicate records should not alter the ranking
- a score should be stable for a fixed clock

The included demo scorer is intentionally simple. It is not a production outlier detector.

## Add persistence

A practical schema separates sources from derivations:

```text
creators
  id, network, canonical_handle, provider_id, active

signal_records
  id, creator_id, published_at, metrics, raw_ref, collected_at

refresh_jobs
  id, state, started_at, completed_at, error_summary

source_cursors
  creator_id, provider, cursor, updated_at

ranked_signals
  record_id, scorer_version, score, evidence, reason, ranked_at
```

Add unique constraints to creator network plus provider ID, and to signal provider plus record ID.

## Add scheduled refresh

Use your platform's scheduler to enqueue a job. The job should:

1. acquire an idempotency key for the time window
2. load active creators and their cursors
3. collect in bounded batches
4. upsert normalized records
5. advance each cursor only after a successful batch
6. run the scorer against a declared window
7. publish one complete snapshot

The manual Refresh action can enqueue the same job type with a user-visible run ID.

## Replace the strategy prompt

Keep the public request shape narrow. Put private instructions in a server-only module or a private package. Version prompts and store evaluation cases without storing secret material in this public repository.

For any action beyond drafting, add an explicit approval step. A content strategist may draft a brief. It should not publish it by default.

## Add authentication

Protect both page data and mutation endpoints. Authorization must be checked on the server for every workspace-scoped operation. Never trust a browser-provided workspace ID without verifying membership.

## Customize the visual system

The design tokens live at the top of `app/globals.css`.

- keep one accent color across the product
- keep controls at 10 px radius and surfaces at 18 px radius
- keep numbers in the mono stack
- keep mobile navigation inside its horizontal container
- test at 360, 768, 1024, and 1440 CSS pixels
