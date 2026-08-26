# Security Model

This workspace is safe only as a synthetic local demo until real services are connected. Every real adapter changes the threat model, and this repository runs with all of them connected.

## Trust boundaries

### Browser

Treat all browser input as untrusted. Do not place provider credentials, Codex auth material, database admin keys, or private prompts in client code or `NEXT_PUBLIC_` variables.

### Collected content

Titles, captions, descriptions, comments, and metadata are untrusted source text. Never allow collected text to become system instructions. Delimit it, validate size, and restrict tools before passing it to a model.

### Provider adapters

Keep credentials in server-side secret storage. Validate response shapes. Bound pagination, retries, concurrency, and history windows.

Downloaded covers are untrusted bytes from a provider CDN. The cover cache only stores a body whose magic bytes identify JPEG, PNG, or WebP, caps the size at 5 MB, fetches only `https:` links without following redirects, streams the body and aborts past the cap, uses a 15 s timeout and at most four downloads at a time, and serves files with the sniffed content type plus `nosniff`. Cache ids are restricted to `[A-Za-z0-9_-]`, so a record id can never become a path.

### Ranking

Assume public metrics can be missing, stale, manipulated, or defined differently by each network. Store provenance and display uncertainty where it matters.

### Strategy bridge

The included bridge is for local development. It binds to `127.0.0.1`, checks browser origins, caps input size, disables network access, uses read-only sandboxing, and requests structured output.

The evidence packet is creator captions, so it is attacker-controlled text. It is clamped twice before it reaches the model: `lib/strategy-evidence.ts` collapses each caption to one bounded line, `bridge/request.mjs` re-truncates every field and coerces plays and outlier to bounded numbers, and the prompt states the packet is untrusted source text, never instructions.

`/v1/hooks` adds a second channel into the prompt, and it is the only one the person types themselves: the source material of a Hooks-Board run. It is clamped the same way and on both sides. `parseHookRequest` (`lib/hooks-board.ts`) refuses anything past `HOOK_INPUT_MAX` (20 000 characters) before it travels, `bridge/request.mjs` cuts it again at `MAX_SOURCE` (24 000), and the requested count is snapped onto one of the three the app can ask for, because the answer schema is built from it. `MAX_BODY_BYTES` in `bridge/server.mjs` is 128 KB so a 20 000 character transcript fits in UTF-8; the cap is still the first thing that stops an oversized body, before any parsing. What comes back is untrusted in the same way: `parseHookBoard` bounds every returned line, refuses a hypothesis outside the five, and drops any cited evidence title the packet does not carry, so a returned board can never name a reel the app did not select. The bridge never echoes internal errors: only validation messages and the logged-out hint reach the client, everything else is a generic failure with the detail in the bridge log. `bridge/auth.mjs` only checks whether the Codex auth file exists; it never reads or forwards its contents.

`/v1/briefing` opens no new channel into the prompt: the packet is the same evidence shape, clamped by the same `validateStrategyRequest`, and the ranked reels come out of the stored corpus rather than out of anything a person typed. What it does add is a positional contract on the way back. The answer schema is built from the packet the bridge accepted (`briefingOutputSchema(count)`), and `applyAngles` (`lib/briefing.ts`) refuses any answer that does not hold exactly one entry per Briefing item, because the bridge drops evidence entries without a title before it builds that schema and a shorter list would push every later angle onto the wrong reel. Each surviving angle is bounded at `BRIEFING_ANGLE_MAX` (300 characters) like every other line the bridge returns. A refusal, an unreachable bridge or a logged-out Codex costs only the angles: `runBriefing` catches around the bridge call alone, and the briefing is stored without them.

Local binding is not production authentication. A deployed endpoint needs:

- authenticated users and workspace authorization
- per-user and per-workspace isolation
- rate limits and quotas
- request and response audit events
- abuse detection
- encrypted secret storage
- explicit data retention and deletion policy
- deployment-specific sandboxing

## Secret handling

- copy `.env.example` to `.env.local`
- never commit `.env.local`
- use your host's encrypted secret store in deployment
- rotate any secret that appears in a log, screenshot, issue, or commit
- use least-privilege provider credentials
- never move Codex session files into the repository

## Data minimization

Collect the smallest public dataset that supports the stated feature. Do not collect personal contact details, private audience information, or unrelated profile history. Define retention before backfilling.

## External actions

This starter drafts and explains. It does not publish, message, buy, delete, or modify third-party systems. Add an explicit human approval boundary before any such action.

## Public release checklist

**Does not apply to this repository.** Signal Room is private and is not published (ADR-0006); the public starter stays at commit `37deeb0` and is not updated from here. The checklist stays on record for the case where a generic part is later cherry-picked out into the public starter.

Before making a derived repository public:

- scan the full Git history, not only the working tree
- search for tokens, cookies, emails, private URLs, provider IDs, and local paths
- remove runtime outputs and real research fixtures
- verify every creator and metric is licensed for release or synthetic
- check package scripts for private hosts and commands
- review prompts, tests, snapshots, logs, and issue templates
- clone the repository into an empty directory and run the documented setup

## Reporting a vulnerability

Do not open a public issue containing sensitive details. Use the private vulnerability-reporting channel configured for the GitHub repository.
