<div align="center">

# Signal Room Starter

### A private creator-intelligence workspace for Instagram reels.

**Convex persistence · Apify Instagram connector · Local Codex bridge · Agent-ready documentation**

[Quick start](#quick-start) · [Architecture](#the-system-at-a-glance) · [Make it yours](#make-it-yours) · [Security boundary](#the-public-private-boundary)

**This repository is private and is not published.** See [ADR-0006](docs/adr/0006-repo-ist-privates-produkt.md).

</div>

![Signal Room Starter interface](docs/assets/signal-room-starter.jpg)

Signal Room collects public creator signals, ranks what deserves attention, turns evidence into a briefing, and develops ideas into storyboards. It grew out of the clean-room starter that still sits at commit `37deeb0` on the public remote; everything since then is identity-specific and stays here. Source choices, scoring theory, prompts, and audience knowledge are part of the product now, not seams left open for someone else.

> [!IMPORTANT]
> The fixtures in `lib/demo-data.ts` are synthetic and only render when the store is empty. With a watchlist connected, every card, score and briefing comes from real collected data. The demo ranker is an educational example, not a recommendation system.

## What you get

| Surface | What works in the starter | What you replace |
|---|---|---|
| Discover | Synthetic feed, relative-reach context, ranked signal cards | Source connector and ranking method |
| Briefing | Daily document after every refresh: the ten strongest reels of the last 24 hours, one angle each, older days pickable | Your ranking weights, angle prompt, and editorial rubric |
| Production slate | Under the briefing: ten short-form starting points read from the same reels, each with a topic and its source reel; regenerate one, keep the rest; a direction for the next run; one click makes an idea | Your slate prompt, the direction you type, the size of the slate |
| Trend Radar | Topic grouping and momentum view | Trend detection and time-window logic |
| Format Signals | Reusable content-format library | Your format taxonomy and performance evidence |
| Tracked Channels | Add-channel flow and daily-watch model | Validation, scheduling, collection, persistence |
| Ideas | Idea workspace and local strategy request | Your strategy prompt, model policy, approval flow |
| Thumbnail Lab | Visual direction and constraint checklist | Image generation, testing data, brand system |
| Hooks | Hooks board: source material in, first-three-second variants grouped by hypothesis, run history | Your hook corpus, hypothesis set, and scoring rules |
| Profile | Adapter status and private-boundary reminder | Authentication, accounts, billing, team settings |

## The system at a glance

![System architecture showing the public product shell, shared contracts, and private implementations](docs/diagrams/rendered/system-at-a-glance.png)

The contracts are the deliberate seam. The interface can remain recognizable while every meaningful intelligence decision is replaced.

## Quick start

Requirements: Node.js 20 or newer and npm.

```bash
git clone https://github.com/earlyaidopters/signal-room-starter.git
cd signal-room-starter
cp .env.example .env.local
npm install
npm run dev:web
```

Open [http://localhost:3000](http://localhost:3000). Demo mode needs no database, provider account, or AI credentials.

Run the full check before changing adapters:

```bash
npm run check
```

## How the data loop works

![Data loop from refresh through collection, normalization, ranking, briefing, and human review](docs/diagrams/rendered/data-loop.png)

### What Refresh should mean in a production build

![Refresh sequence from a person requesting a refresh through collection, ranking, and completion](docs/diagrams/rendered/refresh-sequence.png)

A browser button should not scrape an entire network directly. In a real deployment it should request a bounded background job, report its state, and render the last valid snapshot while work continues.

## Adding a tracked channel

The demo stores a new channel in browser memory. A production adapter should follow this lifecycle:

![Tracked-channel sequence from submitting a handle through validation, backfill, and storage](docs/diagrams/rendered/add-channel-sequence.png)

Build the handler to be idempotent. The same network and canonical channel ID should not create duplicate watch targets.

## The optional Codex bridge

The browser never imports the Codex SDK. A small Node process listens on `127.0.0.1`, validates a narrow evidence packet, starts a read-only Codex thread, and returns structured JSON.

![Codex bridge flow showing bounded browser input, validation, the local SDK, and structured output](docs/diagrams/rendered/codex-bridge.png)

Start it in a second terminal:

```bash
npm run bridge
curl http://127.0.0.1:3211/health
```

`/health` answers `{ ok, service, codex }`, where `codex` is `logged-in` or `logged-out`. The Ideas tab polls it and shows which of the three states you are in — reachable and logged in, not reachable, Codex not logged in — with the command that fixes each one.

Then use **Generate angle** in Ideas. It sends the strongest outlier reels of the last 30 days from your stored corpus; with an empty store the app shows demo fixtures but sends nothing. Window, threshold and packet size live in `lib/config.ts`. The bridge:

- binds to localhost only
- allows configured browser origins only
- caps request bodies at 64 KB
- treats evidence text as untrusted input
- disables network search
- runs Codex with read-only sandboxing and no approvals
- requires a structured response schema
- does not place auth material in client code
- refuses a run when Codex is not logged in, instead of spawning it

The SDK uses the authentication context available to the local Codex CLI process. See the [official Codex documentation](https://developers.openai.com/codex/) for current setup guidance.

## The four extension contracts

```ts
interface SourceConnector {
  readonly id: string;
  collect(creators: Creator[]): Promise<SignalRecord[]>;
}

interface SignalScorer {
  rank(records: SignalRecord[], creators: Creator[], now?: Date): RankedSignal[];
}

interface StorageAdapter {
  listCreators(): Promise<Creator[]>;
  addCreator(creator: Creator): Promise<void>;
  listSignals(): Promise<SignalRecord[]>;
  saveSignals(records: SignalRecord[]): Promise<void>;
}

interface StrategyProvider {
  generate(request: StrategyRequest): Promise<StrategyResponse>;
}
```

They live in [`lib/contracts.ts`](lib/contracts.ts). Keep product components dependent on these contracts, not on vendor response objects.

## Make it yours

Choose one seam at a time.

### Replace the data source

1. Implement `SourceConnector` in `adapters/sources/your-provider.ts`.
2. Resolve each creator to a stable provider ID.
3. Store a per-channel cursor.
4. Normalize every item into `SignalRecord`.
5. Keep provider payloads out of UI components.

### Replace the ranker

1. Implement `SignalScorer`.
2. Write down what the score means before writing the formula.
3. Test monotonic properties and edge cases.
4. Store component evidence beside the final score.
5. Explain the result in human language in Discover.

### Add cloud persistence

1. Implement `StorageAdapter` for your database.
2. Use canonical IDs and unique constraints.
3. Separate raw records from derived rankings.
4. Make refresh jobs idempotent and resumable.
5. Keep credentials on the server.

### Change the strategy layer

1. Copy `bridge/request.mjs` into a private implementation.
2. Replace the generic prompt with your own editorial method.
3. Keep evidence bounded and source-linked.
4. Add approval gates before any external action.
5. Add evaluations before changing the model or prompt in production.

Full recipes are in [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md).

## The public-private boundary

![Public and private boundary separating the starter shell from identity-specific intelligence](docs/diagrams/rendered/public-private-boundary.png)

The boundary moved when this repository became private (ADR-0006). The public starter at `37deeb0` still holds the line in the diagram. Here, the watchlist, the outlier thresholds, the strategy prompts and the positioning are the product.

What stays out of Git even so:

- secrets, session material, tokens, cookies, and account identifiers
- everything in `.env.local`, including the strategy goal and audience
- the collected corpus and the cover cache (`data/`, ignored)
- the local issue tracker and review output (`.scratch/`, `reviews/`, ignored)

Read [docs/SECURITY.md](docs/SECURITY.md) before connecting any real account.

## Repository map

```text
app/                    Next.js shell and visual system
components/             Interactive workspace
lib/contracts.ts        Stable extension interfaces
lib/demo-data.ts        Synthetic fixtures, rendered only when the store is empty
lib/demo-score.ts       Transparent educational ranker
bridge/                 Optional localhost Codex process
tests/                  Contract and safety tests
docs/                   Architecture and build guides
.github/workflows/      Build and test checks
AGENTS.md                Cold-start instructions for coding agents
```

## Build with an agent

Start with this request:

```text
Read AGENTS.md and docs/AGENT-BUILD-GUIDE.md completely. Keep demo mode working.
Implement one adapter behind the existing contract. Do not copy scoring logic,
prompts, watchlists, or runtime data from another project. Show me the data flow,
tests, environment variables, and security boundary before connecting real data.
```

The build guide includes acceptance checks and a recommended sequence for agent-assisted implementation.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Customization recipes](docs/CUSTOMIZATION.md)
- [Agent build guide](docs/AGENT-BUILD-GUIDE.md)
- [Security model](docs/SECURITY.md)
- [Contributing](CONTRIBUTING.md)

### Updating the diagrams

The rendered images are committed so GitHub mobile and other Markdown viewers never need Mermaid support. Edit the matching `.mmd` file in `docs/diagrams/sources`, then regenerate every image:

```bash
npm run diagrams
```

## License

MIT. Use the shell, replace the intelligence, and make the system genuinely yours.
