# `@quantdesk/venues` — Path B fetch guide registry

This package holds optional, venue-specific cheatsheets that an analyst
agent consults when the engine's bundled downloader (**Path A**) fails
and the agent has to fetch OHLCV data itself (**Path B**). Each guide
is a TypeScript module; the server renders it to markdown at desk
creation and seeds the rendered file into the workspace at
`.quantdesk/PATH_B_FETCH_<venue>.md`.

Guides live as TS (not `.md`) so they ship as ordinary compiled code
with the rest of the server — no filesystem catalog to bundle, no
runtime path resolution, no sandbox carve-outs.

## Why per-venue?

Each exchange has its own quirks:

- ccxt coverage differs (some venues need their own SDK or raw REST)
- symbol formats differ (`BTC/USDT:USDT`, `BTC-USDT-SWAP`, `BTC_USDT_USDT`, …)
- spot vs. futures endpoints live at different URLs
- rate limits, auth requirements, page-size caps all vary

Hard-coding every venue into the agent prompt would bloat it. Letting
the LLM rediscover each venue every turn wastes turns and sometimes
fails. A small, empirically verified per-venue guide is the middle
ground.

## Layout

```
packages/venues/
  package.json          ← workspace package @quantdesk/venues
  tsconfig.json
  README.md             ← this file
  src/
    index.ts            ← registry + getVenueGuide + renderVenueGuideMarkdown
    types.ts            ← VenueGuide schema
    _example.ts         ← template (not registered)
    <venue>.ts          ← real guide for each venue
```

- Filenames starting with `_` are conventionally reserved for
  templates / WIP drafts and are never registered.
- One file = one venue. The venue id (`binance`, `hyperliquid`, …)
  must be lowercase and must match the string stored in
  `desks.venues[]`.

## How it is consumed

At desk creation, `initWorkspace` in `server/src/services/workspace.ts`
calls `loadVenueGuides(desk.venues)`, which:

1. For each venue in `desks.venues[]`, calls
   `getVenueGuide(venue)` from `@quantdesk/venues`.
2. For any venue that returns a guide, renders it with
   `renderVenueGuideMarkdown(...)` and writes the result to
   `<workspace>/.quantdesk/PATH_B_FETCH_<venue>.md`.
3. Commits the file into the desk's workspace git repo so the
   seed-file timeline is reproducible.

The analyst's `mode-classic` prompt block tells the agent: *"Before
following the generic Path B steps, check whether
`.quantdesk/PATH_B_FETCH_<venue>.md` exists and prefer its
venue-specific instructions."* Missing venues degrade silently — the
agent follows the generic fallback as before.

Critically, the agent reads the guide from **inside its workspace**,
never from this package directly. The per-turn Claude settings file
denies tool access to the QuantDesk repo root; workspace-seeding is
the only supported path from this catalog to the agent.

## Adding a new venue guide

Five steps. Expect the verification step (step 3) to take the most
time — a wrong guide is worse than no guide.

### 1. Create the module

Copy `src/_example.ts` to `src/<venue-id>.ts` and fill in every
field. Replace `venue`, `displayName`, and `export const` binding name:

```ts
// src/hyperliquid.ts
import type { VenueGuide } from "./types.js";

export const hyperliquidGuide: VenueGuide = {
  venue: "hyperliquid",
  displayName: "Hyperliquid Perps",
  tldr: "...",
  symbolFormat: { linearFutures: "BTC (native POST /info)" },
  recommendedFetch: {
    language: "python",
    library: "httpx",
    code: "...",
  },
  pagination: "...",
  knownGotchas: ["...", "..."],
  lastVerified: "2026-04-09",
  verificationNotes: "BTC 5m, 1000 rows, httpx 0.27.x",
};
```

The `VenueGuide` type (see `src/types.ts`) documents every field. All
fields are required — pick the schema on purpose rather than leaving
blanks.

### 2. Register it

Import the new module at the top of `src/index.ts` and add it to the
`REGISTRY` map:

```ts
import { hyperliquidGuide } from "./hyperliquid.js";

const REGISTRY: Record<string, VenueGuide> = {
  hyperliquid: hyperliquidGuide,
};
```

The key must match `guide.venue` and the lowercase venue string used
in `desks.venues[]`.

### 3. Verify empirically

Actually run your `recommendedFetch.code` against the live venue
**before committing**. Confirm:

- the snippet works verbatim (after filling in symbol/timeframe)
- symbol formats match what the venue returns
- pagination rules hold for a multi-page fetch
- rate-limit behaviour is as documented
- timestamps and row counts look correct

Then set `lastVerified` to today's date and fill `verificationNotes`
with a one-sentence description of what you ran (pair, timeframe,
library version, expected row count). **If you cannot verify, delete
the file rather than commit unverified placeholder text.**

### 4. Typecheck + commit

```bash
pnpm -r typecheck
git add packages/venues/src/<venue-id>.ts packages/venues/src/index.ts
git commit -m "feat(venues): add <venue> Path B fetch guide"
```

No migration, no prompt edit, no server restart handling — the server
re-reads the registry on each desk creation.

### 5. Verify the seed

Create a new desk that uses the venue, then check:

```bash
ls ~/.quantdesk/workspaces/<deskId>/.quantdesk/
# expect: PATH_B_FETCH_<venue>.md

cat ~/.quantdesk/workspaces/<deskId>/.quantdesk/PATH_B_FETCH_<venue>.md
```

The file should contain your rendered guide. To confirm the agent
actually reads it during a Path B scenario, tail the experiment log
while triggering a Path A failure:

```bash
tail -f "$(ls -t ~/.quantdesk/logs/*.jsonl | head -1)" \
  | jq 'select(.type=="tool_call" and .name=="Read")'
```

## Scope rules

- **Only `packages/venues/` knows about venues.** Engine-specific
  save-path / data-format details belong in `packages/engines/<engine>/`,
  not here. A venue guide describes *how to fetch*, not *where to save*.
- **This is not a whitelist.** Desks with venues that have no guide
  still work exactly as before — the agent falls back to the generic
  Path B text in `mode-classic.ts`.
- **This is not a live data source.** Guides are static hints. The
  agent still runs actual fetch code and handles runtime failures.
- **Existing desks don't retro-receive new guides.** A desk's
  workspace is seeded once at creation; mid-experiment seed changes
  would break reproducibility. If you really need to back-fill a
  guide onto an existing desk, copy the rendered markdown into that
  workspace's `.quantdesk/` directory manually and commit it inside
  the workspace git repo.

## Non-goals

- Building a universal venue adapter layer. If that's needed one day,
  it'll live somewhere else — this package stays focused on
  human-authored cheatsheets for the agent to read.
- Mapping venue × engine combinations. The engine side of Path B
  (where to save fetched data so the framework picks it up) is the
  engine adapter's concern.
- Auto-generating guides from ccxt metadata. Generated text isn't
  verified text, and the whole point of this catalog is that every
  guide has been run against the live venue.
