# Adding a New Engine

An **engine** is a backtesting / paper-trading framework that QuantDesk delegates strategy execution to. The current set of engines and the scope of which adapters we ship live in `doc/engine/README.md`. Adding a new engine means implementing the `EngineAdapter` interface, registering it, and mapping it to a `strategy_mode`.

This is a larger change than adding a venue. **Please open an issue first to discuss design and scope** before opening a PR.

## Prerequisites

- Familiarity with the target engine's CLI / SDK and how it runs backtests and paper trades.
- Read [./README.md](./README.md) for the full interface contract and the per-engine workspace layout.

## Steps

### 1. Create the package directory

```
packages/engines/src/<engine-name>/
└── adapter.ts
```

Use an existing adapter as a starting point — `freqtrade/adapter.ts` is the most fleshed-out reference.

### 2. Implement the `EngineAdapter` interface

The interface and all related config / result types are defined in `packages/engines/src/types.ts` — read that file for the exact, up-to-date signatures. The per-method responsibilities (`name`, `ensureImage`, `downloadData`, `runBacktest`, `startPaper`, `stopPaper`, `getPaperStatus`, `parseResult`), the Docker image pinning rule, workspace mount conventions, and the container label set all live in `doc/engine/README.md`. Implement against that contract.

**When adding a new engine, remember:**

- Result normalization is critical — the UI assumes consistent metric names. See `NormalizedResult` in `types.ts`.
- CLAUDE.md rules #6 (engine names never leak to the UI) and #10 (mode/engine immutable per desk) apply to any new engine.

### 3. Register the adapter

Edit `packages/engines/src/registry.ts`:

```ts
import { MyEngineAdapter } from "./my-engine/adapter.js";

const adapters: Record<string, EngineAdapter> = {
  freqtrade: new FreqtradeAdapter(),
  nautilus: new NautilusAdapter(),
  generic: new GenericAdapter(),
  my_engine: new MyEngineAdapter(),
};
```

### 4. Add a strategy catalog

Create `strategies/<engine-name>.json` with at least one starter strategy. Use `strategies/freqtrade.json` or `strategies/nautilus.json` as a template. Each entry needs:

```json
{
  "id": "<engine_prefix>_<strategy_name>",
  "name": "Display Name",
  "category": "trend_following | mean_reversion | market_making | momentum | arbitrage",
  "difficulty": "easy | medium | advanced",
  "description": "One-line technical description",
  "summary": "Plain-English summary for non-technical users",
  "indicators": ["EMA", "RSI"],
  "default_params": { "fast_period": 10 },
  "timeframes": ["1m", "5m", "1h"],
  "engine": "<engine-name>",
  "source": "https://link-to-upstream-strategy-source"
}
```

### 5. Add venues

Edit `strategies/venues.json` and add your engine's ID to the `engines` array of every venue it supports. Each entry has `id`, `name`, `assetClass`, `type`, `url`, and `engines` — see existing entries as a template. A venue is "supported" only if your adapter can `downloadData` and `runBacktest` against it end-to-end.

### 6. Add tests

Create `packages/engines/src/__tests__/<engine-name>.test.ts`. At minimum, test:

- `parseResult` correctly normalizes a sample raw output.
- `ensureImage` throws when Docker is unavailable or the pinned image tag cannot be pulled.

Heavy integration tests that actually spawn the engine should be tagged so they only run in CI.

### 7. Document the engine

Add a short section to `doc/engine/README.md` describing:
- What asset classes the engine covers.
- Installation / runtime requirements (Docker image, Python version, etc.).
- Any quirks in the result format.

### 8. Verify

```bash
pnpm typecheck && pnpm check && pnpm test && pnpm build
```

Run the full flow in dev mode:

```bash
pnpm dev
```

Create a desk that uses your new engine, run a backtest, confirm the result table populates correctly.

### 9. Open a PR

Title: `feat: add <Engine Name> engine adapter`

Include in the description:
- Link to the issue where the engine was discussed.
- Asset classes / venues now supported.
- Installation instructions for reviewers (Docker image tag, pip package version, etc.).
- Sample backtest output showing the normalized metrics look right.

## Design Notes

### Why is `name` required as a constant on the adapter?

It's used as the lookup key in `registry.ts` and as the engine field in `strategies/<engine>.json`. Keeping it on the class avoids drift between the registration key and the adapter's identity.

### Why are engines hidden from the user UI?

QuantDesk's value proposition is "describe a strategy, get a backtest" — the user shouldn't need to know whether Freqtrade or Nautilus is running under the hood. Instead, users pick a **strategy mode** (`classic` or `realtime`) during desk creation, and the system derives the engine from the mode + venue intersection. See `CLAUDE.md` rule 6 and `doc/engine/README.md`.

### Can I add an engine that only supports backtesting (no paper)?

Yes. Implement `startPaper` / `stopPaper` / `getPaperStatus` to throw a clear "not supported" error. The UI will gracefully disable the **Start Paper Trading** action for desks bound to backtest-only engines (handled in the paper trading flow).

### Can I add an engine that wraps an external API instead of a local binary?

Yes. `ensureImage` can pull a generic runtime image (Python/Node base) instead of an engine-specific one. Validate any required API credentials at the start of `runBacktest` / `startPaper`. Network calls happen inside the container like any other engine — but be mindful of rate limits and idempotency. Trading API keys are out of scope per CLAUDE.md rule #5; market data keys are acceptable.
