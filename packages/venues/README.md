# venues — Path B fetch guides (per-venue)

This directory is a **reference catalog**, not a package. It holds optional,
venue-specific hints that an analyst agent can consult when the engine's
bundled downloader (Path A) fails and the agent has to fetch OHLCV data
itself (Path B).

## Why per-venue?

Each exchange has its own quirks:

- ccxt coverage differs (some venues need the venue's own SDK or raw REST)
- symbol formats differ (`BTC/USDT:USDT`, `BTC-USDT-SWAP`, `BTC_USDT_USDT`, …)
- spot vs. futures endpoints live at different URLs
- rate limits, auth requirements, page-size caps all vary

Hard-coding these in the agent prompt would bloat it. Letting the LLM
rediscover them every turn wastes turns and sometimes fails. A small
per-venue cheatsheet, seeded into the desk workspace at creation time, is
the middle ground.

## Layout

```
packages/venues/
  README.md                     ← this file
  _example/
    path-b-fetch.md             ← template showing the expected shape
  <venue-id>/
    path-b-fetch.md             ← real guide, copied into workspaces
```

- `<venue-id>` must match the venue string the desk stores in
  `desks.venues[]` (lowercase, e.g. `binance`, `bybit`, `hyperliquid`).
- Directories starting with `_` are ignored by the loader and never
  copied — use them for templates, examples, or WIP drafts.
- Only `path-b-fetch.md` is read today. Other filenames are reserved for
  future use.

## How it's consumed

At desk creation, `initWorkspace` (`server/src/services/workspace.ts`)
calls the venue-guide loader with the desk's `venues[]` list. For each
venue that has a `path-b-fetch.md` here, the file is copied into the
workspace at:

```
<workspace>/.quantdesk/PATH_B_FETCH_<venue>.md
```

The agent reads it from there — never from this repo directly (the
per-turn Claude settings file denies tool access to the QuantDesk repo
root, so workspace-seeding is the only supported path).

The `mode-classic.ts` prompt block tells the agent: *"If
`.quantdesk/PATH_B_FETCH_*.md` files exist in your workspace, read them
before falling back to the generic Path B steps."* Missing files are
silently skipped — the agent follows the generic fallback as before.

## Adding a new venue guide

1. Create `packages/venues/<venue-id>/path-b-fetch.md`.
2. Use `_example/path-b-fetch.md` as a starting point.
3. **Verify the instructions empirically** before committing — a wrong
   guide is worse than no guide. At minimum:
   - run the example ccxt / REST snippet against the live venue
   - confirm symbol formats match what the venue returns
   - note the date the check was done (venue APIs drift)
4. Existing desks do **not** retro-receive the new guide. Only desks
   created after the file lands will have it seeded into their
   workspace. That's intentional — changing a live desk's seed files
   mid-experiment would break reproducibility.

## Non-goals

- **This is not a whitelist.** Desks with venues that have no guide
  here still work exactly as they do today — the agent falls back to
  the generic Path B instructions in `mode-classic.ts`.
- **This is not engine-specific.** Guides describe how to *fetch* OHLCV
  from the venue, not where to *save* it for any particular framework.
  Save-location is the engine's concern and lives in the engine adapter.
- **This is not a live data source.** Guides are static hints. The
  agent still has to run actual fetch code and handle failures at
  runtime.
