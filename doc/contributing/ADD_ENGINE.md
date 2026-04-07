# Adding a New Engine

An **engine** is a backtesting / paper-trading framework that QuantDesk delegates strategy execution to. Current engines: Freqtrade, Hummingbot, Nautilus, Generic. Adding a new one means implementing the `EngineAdapter` interface and registering it.

This is a larger change than adding a venue. **Please open an issue first to discuss design and scope** before opening a PR.

## Prerequisites

- Familiarity with the target engine's CLI / SDK and how it runs backtests and paper trades.
- Read [doc/architecture/ENGINE_ADAPTER.md](../architecture/ENGINE_ADAPTER.md) for the full interface contract.
- Read [doc/architecture/WORKSPACE.md](../architecture/WORKSPACE.md) to understand per-desk git workspaces.

## Steps

### 1. Create the package directory

```
packages/engines/src/<engine-name>/
└── adapter.ts
```

Use an existing adapter as a starting point — `freqtrade/adapter.ts` is the most fleshed-out reference.

### 2. Implement the `EngineAdapter` interface

Defined in `packages/engines/src/types.ts`:

```ts
export interface EngineAdapter {
  readonly name: string;
  ensureInstalled(): Promise<void>;
  downloadData(config: DataConfig): Promise<DataRef>;
  runBacktest(config: BacktestConfig): Promise<BacktestResult>;
  startPaper(config: PaperConfig): Promise<PaperHandle>;
  stopPaper(handle: PaperHandle): Promise<void>;
  getPaperStatus(handle: PaperHandle): Promise<PaperStatus>;
  parseResult(raw: string): NormalizedResult;
}
```

Method responsibilities:

| Method | What it does |
|---|---|
| `name` | Stable engine ID. Must match the key used in `registry.ts` and `venues.json`. |
| `ensureInstalled` | Verify the engine binary / Docker image / Python env is available. Throw a clear error if not. |
| `downloadData` | Fetch historical OHLCV (or tick) data into the desk workspace. Return a `DataRef`. |
| `runBacktest` | Run a backtest using the strategy file in the workspace. Return raw output + normalized result. |
| `startPaper` | Spawn a paper trading process. Return a handle. |
| `stopPaper` | Cleanly terminate a paper process by handle. |
| `getPaperStatus` | Query a running paper process for health + PnL. |
| `parseResult` | Convert the engine's raw output JSON into `NormalizedResult`. Pure function — should be unit-testable without spawning processes. |

**Important conventions:**

- All process work happens **inside the desk workspace** (`config.workspacePath`). Never write outside it.
- QuantDesk currently supports **paper trading only** — no real-money execution.
- Result normalization is critical — the UI assumes consistent metric names. See `NormalizedResult` in `types.ts`.
- Engine names must **never leak to the user-facing UI**. The agent picks the engine internally based on the desk's strategy and venue.

### 3. Register the adapter

Edit `packages/engines/src/registry.ts`:

```ts
import { MyEngineAdapter } from "./my-engine/adapter.js";

const adapters: Record<string, EngineAdapter> = {
  freqtrade: new FreqtradeAdapter(),
  hummingbot: new HummingbotAdapter(),
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

Edit `strategies/venues.json` to add the engine ID to the `engines` array of every venue your engine supports. See [ADD_VENUE.md](ADD_VENUE.md) for the venue format.

### 6. Add tests

Create `packages/engines/src/__tests__/<engine-name>.test.ts`. At minimum, test:

- `parseResult` correctly normalizes a sample raw output.
- `ensureInstalled` throws when the engine binary is missing.

Heavy integration tests that actually spawn the engine should be tagged so they only run in CI.

### 7. Document the engine

Add a short section to `doc/architecture/ENGINE_ADAPTER.md` describing:
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

QuantDesk's value proposition is "describe a strategy, get a backtest" — the user shouldn't need to know whether Freqtrade or Nautilus is running under the hood. The agent picks the engine based on the desk's venue and strategy. See `CLAUDE.md` rule #6.

### Can I add an engine that only supports backtesting (no paper)?

Yes. Implement `startPaper` / `stopPaper` / `getPaperStatus` to throw a clear "not supported" error. The UI will gracefully disable the **Start Paper Trading** action for desks bound to backtest-only engines (handled in the paper trading flow).

### Can I add an engine that wraps an external API instead of a local binary?

Yes. `ensureInstalled` should validate API credentials are present. Network calls happen in `runBacktest` / `startPaper` like any other engine — but be mindful of rate limits and idempotency.
