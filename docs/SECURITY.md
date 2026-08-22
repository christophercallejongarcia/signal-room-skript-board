# Security Model

This starter is safe only as a synthetic local demo until you connect real services. Every real adapter changes the threat model.

## Trust boundaries

### Browser

Treat all browser input as untrusted. Do not place provider credentials, Codex auth material, database admin keys, or private prompts in client code or `NEXT_PUBLIC_` variables.

### Collected content

Titles, captions, descriptions, comments, and metadata are untrusted source text. Never allow collected text to become system instructions. Delimit it, validate size, and restrict tools before passing it to a model.

### Provider adapters

Keep credentials in server-side secret storage. Validate response shapes. Bound pagination, retries, concurrency, and history windows.

### Ranking

Assume public metrics can be missing, stale, manipulated, or defined differently by each network. Store provenance and display uncertainty where it matters.

### Strategy bridge

The included bridge is for local development. It binds to `127.0.0.1`, checks browser origins, caps input size, disables network access, uses read-only sandboxing, and requests structured output.

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
