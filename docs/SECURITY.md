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

The Trend-Radar adapter accepts only the configured Instagram hashtag list and the bounded `posts` actor stream. Captions are treated as untrusted public text, filtered with a deterministic German heuristic, truncated before storage, and classified by local keyword rules. There is no X input path. A hashtag sweep refuses to persist posts when Apify's cost is missing or above `INSTAGRAM_HASHTAG_COST_LIMIT_USD`, and the failed run records the reason.

### Ranking

Assume public metrics can be missing, stale, manipulated, or defined differently by each network. Store provenance and display uncertainty where it matters.

### Strategy bridge

The included bridge is for local development. It binds to `127.0.0.1`, checks browser origins, caps input size, disables network access, uses read-only sandboxing for text runs, and requests structured output. Cover image runs use a temporary workspace that is discarded after the image bytes are returned; they never receive a repository path.

Transcript analysis uses the same localhost-only Bridge boundary. Transcript chunks and dictionary-derived working copies are untrusted source text. The server validates feature names, literal quotes and character positions before persistence. Cloud refreshes may create queue rows, but cannot call the local Bridge.

Convex queue-control and result-write mutations fail closed unless their server caller supplies `TRANSCRIPT_ANALYSIS_WORKER_TOKEN`, configured separately in `.env.local` and the Convex deployment. The browser never receives this token. Automatic Signal writes enqueue in their existing transaction; internal mutation variants support the atomic Convex tests.

The evidence packet is creator captions, so it is attacker-controlled text. It is clamped twice before it reaches the model: `lib/strategy-evidence.ts` collapses each caption to one bounded line, `bridge/request.mjs` re-truncates every field and coerces plays and outlier to bounded numbers, and the prompt states the packet is untrusted source text, never instructions.

The transcript actor is another untrusted provider boundary. Its text and time segments are mapped in `lib/adapters/sources/apify-transcripts.ts`; only segments with finite timestamps are stored, and actor errors on a Signal are capped at `TRANSCRIPT_ERROR_MAX` characters. The manual `/api/signals/transcribe` route validates the Signal id, claims one Reel atomically, and writes through a transcript-only storage patch, so provider output cannot alter metrics, captions, or saved marks. A failed actor batch stays out of the automatic retry path, so a provider outage cannot create an unbounded paid loop. The legacy status repair only removes `silent` or `missing` when no transcript exists.

Transcript correction suggestions are untrusted Bridge output. `/v1/transcript-corrections` receives a bounded original transcript and returns a closed schema limited to recognition errors. `parseTranscriptCorrectionResponse` drops empty, duplicate, overlong, or non-literal suggestions, and `original` is replaced everywhere by a pure literal operation. The API stores only bounded correction records, keeps the original unchanged, and recomputes the working copy from accepted decisions. Corrections cannot alter metrics, captions, saved marks, or external systems.

The personal transcript dictionary stores only bounded `wrong`, `right` and `createdAt` pairs in the server-side storage adapters. Dictionary matches are applied deterministically to the Reel's original transcript before the Bridge is called. The full list is bounded again before it reaches the local Bridge, and a Bridge suggestion that contradicts a known mapping is discarded. A dictionary correction can still be rejected on one Reel without changing the global entry; adding or removing the global mapping requires the explicit control in the correction list.

`/v1/hooks` adds a second channel into the prompt, and it is the only one the person types themselves: the source material of a Hooks-Board run. It is clamped the same way and on both sides. `parseHookRequest` (`lib/hooks-board.ts`) refuses anything past `HOOK_INPUT_MAX` (20 000 characters) before it travels, `bridge/request.mjs` cuts it again at `MAX_SOURCE` (24 000), and the requested count is snapped onto one of the three the app can ask for, because the answer schema is built from it. `MAX_BODY_BYTES` in `bridge/server.mjs` is 128 KB so a 20 000 character transcript fits in UTF-8; the cap is still the first thing that stops an oversized body, before any parsing. What comes back is untrusted in the same way: `parseHookBoard` bounds every returned line, refuses a hypothesis outside the five, and drops any cited evidence title the packet does not carry, so a returned board can never name a reel the app did not select. The bridge never echoes internal errors: only validation messages and the logged-out hint reach the client, everything else is a generic failure with the detail in the bridge log. `bridge/auth.mjs` only checks whether the Codex auth file exists; it never reads or forwards its contents.

`/v1/briefing` opens no new channel into the prompt: the packet is the same evidence shape, clamped by the same `validateStrategyRequest`, and the ranked reels come out of the stored corpus rather than out of anything a person typed. What it does add is a positional contract on the way back. The answer schema is built from the packet the bridge accepted (`briefingOutputSchema(count)`), and `applyAngles` (`lib/briefing.ts`) refuses any answer that does not hold exactly one entry per Briefing item, because the bridge drops evidence entries without a title before it builds that schema and a shorter list would push every later angle onto the wrong reel. Each surviving angle is bounded at `BRIEFING_ANGLE_MAX` (300 characters) like every other line the bridge returns. A refusal, an unreachable bridge or a logged-out Codex costs only the angles: `runBriefing` catches around the bridge call alone, and the briefing is stored without them.

`/v1/slate` carries the same packet, clamped by the same `validateStrategyRequest`, plus two small typed inputs: the direction the person typed for the run and the pitches already on the slate (`taken`). Both are bounded on both sides, the direction at `SLATE_DIRECTION_MAX` (500) in `parseSlateDirection` and at `MAX_GOAL` in the bridge, the taken pitches at `MAX_PITCH` and at most ten, and the prompt names them as what they are. `count` is validated as a whole number from 1 to 10 because the answer schema is built from it. On the way back a start names its reel as a 1-based position into the packet the bridge accepted, never as a title, and `parseSlateAnswer` (`lib/slate.ts`) refuses an answer that does not hold exactly `count` starts or names a position outside the packet, so a returned slate can never point at a reel the app did not select; pitch and topic are bounded like every other returned line. The slate is written only from an answer that passed whole, and a refusal writes nothing.

`/v1/covers` accepts only `reel` (4:5) or `youtube` (16:9), validates the treatment and the developed Idea brief, and requires exactly three package descriptions for a new board or one for a replacement. Overlay text is capped at four words and every package field is bounded before it reaches GPT Image. The returned image is base64-decoded and magic-byte checked by the app before it is written below the gitignored `data/covers/ideas/` tree. The dynamic image route accepts only safe Idea, format and package identifiers and serves the stored bytes with `nosniff`.

The Script boundary stores Hook-Options, evidence references and section text as untrusted content. `lib/scripts.ts` bounds identifiers and every returned line, resolves Hook evidence only against the accepted packet, validates the four allowed statuses, and refuses a complete Script without exactly one Hook, one CTA and two to five Beats. `PATCH /api/scripts/<id>` accepts only bounded section, framework, Hook-Option, selection and evidence fields; the reading view carries source indexes instead of turning joined text back into sections. Status moves are checked again in both storage adapters. Convex carries the same `ForbiddenMoveError` reason as `{ kind: "forbidden-move" }`, and the approved state can only be left through the explicit human reopening move. Script runs use a claim id, so late Bridge results are discarded instead of replacing newer work. Demo Scripts are synthetic fixtures and never enter the real evidence packet.

`POST /api/ideas/develop` is the Script Hook boundary. The app selects at most ten stored Reels from the configured window, adds the source Reel even when it is older, prefers the reviewed transcript working copy, and caps source and evidence transcripts separately before sending them to `/v1/script-hooks`. `validateScriptHooksRequest` clamps the packet again. The Bridge prompt treats the Idea, transcripts, captions and metrics as untrusted source text and runs Codex with no network, no web search and a read-only sandbox. `scriptHooksOutputSchema` requires three to five Hook options, a framework and a fit reason; `parseScriptHooksAnswer` drops every evidence title that is not in the packet, so model text cannot attach an invented Reel. A failed call releases both the Idea and Script claims. No Bridge is called for empty-store demo mode, whose fixed options contain no collected content.

`POST /api/scripts/<id>/draft` sends the chosen Hook, Angle and framework with only the Script's bounded source and evidence Reels to `/v1/script-draft`. The response remains untrusted until `parseScriptDraftAnswer` has enforced the complete section invariant, compared the returned Hook verbatim with the stored choice, and run the deterministic anti-copy check. That check lowercases and collapses whitespace, then rejects the first generated sentence of at least `SCRIPT_COPY_SENTENCE_MIN_WORDS` (8) words that occurs in any supplied transcript or caption. Rejection exposes the copied sentence, releases `runId`, and stores no section. A successful settle replaces all sections and increments the revision. The Bridge cannot bypass these checks by returning a schema-valid response.

`POST /api/scripts/<id>/storyboard` is gated by the current approved revision and uses an explicit read-only `runId` claim. That claim is the only approved-Script mutation allowed during the run. It blocks a second Bridge call and is released after success or failure; a release failure reaches the caller instead of reporting success. The Bridge request validator requires one Hook, one CTA and two to five Beats. The returned Hook is discarded in favor of the approved Script Hook, while exact normalized repetitions among Hook, Beat details, CTA and Caption lines reject the whole write. The resulting Storyboard fields are patched atomically onto the current Idea row, preserving concurrent stage and cover writes. Synthetic Storyboard answers are available only when Scripts, Ideas, Signals and Creators are all empty.

The Lektorat boundary is also review-only. `POST /api/scripts/<id>/lint` sends only bounded Script sections with generated ids to `/v1/script-lint`; the Bridge reads the installed skill from `.agents/skills/slop-check`, runs its deterministic Regex stage without a temporary file, and supplies the pattern catalogue plus false-positive list to the Modell stage. The section text is attacker-controlled source material and is explicitly delimited as such. `scriptLintOutputSchema` bounds the response, while `parseScriptLintResponse` drops unknown sections, duplicates, empty lines, overlong values and any `original` that is not a literal occurrence in the named section. A successful run stores no suggestion and changes no section. `runId` blocks concurrent editing, and the error path settles the claim before exposing the cause. Only a human's individual acceptance calls the existing Script PATCH path and increments the revision; approved Scripts stay locked. Demo suggestions are synthetic and never reach the Bridge.

`POST /api/scripts/<id>/storyboard` reads only a human-approved Script revision and its canonical evidence ids. The Bridge receives bounded sections as untrusted source material through the second `/v1/storyboard` input form. Its Hook is never trusted: the app replaces it with the stored Script Hook before saving. A deterministic equality check lowercases and collapses whitespace across that Hook, all Beat details, the spoken CTA and each non-empty Caption line; one duplicate rejects the whole response. The Forecast uses only comparable titles resolved from the accepted packet. `commentCta` and `leadMagnetCta` are stored as separate empty fields in this phase, so the Bridge cannot invent later automation actions. The route changes only the linked Idea and performs no publication or messaging action.

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

## Local Pattern discovery

Pattern hypotheses and explicit presence/absence checks run only through the localhost Codex Bridge. The Next route sends bounded transcript text and a bounded saved definition. The Bridge treats both as untrusted source text, disables network access, and uses structured output. A `present` quote is accepted only when its character range exactly resolves in the supplied transcript. Convex Pattern writes use the server-held `TRANSCRIPT_ANALYSIS_WORKER_TOKEN` boundary. Browser clients never receive that token and cannot call the protected mutation directly.

Pattern discovery never invokes Apify or another paid provider. Reels without a current complete analysis stay visible as unknown. A paid transcript attempt starts only from the existing manual Reel action after Chris selects that Reel.

## Reporting a vulnerability

Do not open a public issue containing sensitive details. Use the private vulnerability-reporting channel configured for the GitHub repository.

Pattern comparisons select at most 20 matching Reels in deterministic publication/id order and show the selected/eligible count. Current analysis IDs are read directly. Both presence and absence require literal transcript evidence with matching positions. Thresholds can be set through PATTERN_MIN_POSITIVE_REELS, PATTERN_MIN_POSITIVE_CREATORS and PATTERN_MIN_NEGATIVE_REELS (positive integers up to 20).
