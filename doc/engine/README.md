# Engine Adapter

Pluggable interface for backtesting and paper trading engines. QuantDesk supports **two managed engines** plus a fallback:

- **Freqtrade** — for `classic` strategy mode (candle-based polling, TA indicators)
- **Nautilus Trader** — for `realtime` strategy mode (event-driven, tick-level)
- **Generic** — fallback for venues with no managed engine (backtest only, no paper trading)

All engine processes run inside Docker containers using official engine images with **pinned version tags**. The server, UI, and agent CLI run on the host — only the engine layer is containerized. See `CLAUDE.md` rules 6–12 for the binding constraints.

## Strategy Mode

Users never pick an engine directly. During onboarding they choose a **strategy mode**:

| Mode | Engine | Description |
|---|---|---|
| `classic` (recommended) | Freqtrade | Candle-based polling strategies, TA indicators, minute-to-hour timeframes. Best for trend following, mean reversion, momentum. |
| `realtime` (advanced) | Nautilus | Event-driven strategies reacting to ticks and order book deltas, sub-second timeframes. Best for market making, arbitrage, HFT. |

Each desk pins a `strategy_mode` at creation. The corresponding engine is derived from the mode and stored in `desks.engine`. Both are immutable for the desk's lifetime.

## Interface

The full `EngineAdapter` contract and all related config / result types live in `packages/engines/src/types.ts` — that file is the source of truth and is the only place that should change when the interface evolves.

At a high level the adapter exposes the following methods:

| Method | Purpose |
|---|---|
| `name` | Stable engine id (must match the registry key and the value used in `venues.json`). |
| `ensureImage()` | Pull the pinned Docker image for this engine. Native host installs are not supported. |
| `downloadData(config)` | Fetch historical OHLCV (or tick) data into the desk workspace via an ephemeral container. |
| `runBacktest(config)` | Run a backtest in an ephemeral container, return raw output + `NormalizedResult`. |
| `startPaper(config)` | Spawn a long-lived paper container labelled `quantdesk.runId` / `quantdesk.engine` / `quantdesk.kind=paper`. |
| `stopPaper(handle)` | Stop a paper container by handle (graceful → SIGTERM fallback). |
| `getPaperStatus(handle)` | Query a running paper container for health + PnL via the engine-specific mechanism (REST for Freqtrade, stdout JSONL for Nautilus). |
| `parseResult(raw)` | Pure function from raw engine output to `NormalizedResult`. Unit-testable without spawning processes. |

`NormalizedResult` is the cross-engine reporting contract. Engines may differ wildly in raw output but must always normalise to the same shape so the UI and the agent see consistent metrics.

## Engine Resolution

Engine is derived from `strategy_mode`, not from a priority list:

```ts
const MODE_TO_ENGINE: Record<StrategyMode, EngineName> = {
  classic: "freqtrade",
  realtime: "nautilus",
};

function resolveEngine(venue: Venue, mode: StrategyMode): EngineName {
  const engine = MODE_TO_ENGINE[mode];
  if (!venue.engines.includes(engine)) {
    throw new Error(
      `Venue ${venue.name} does not support ${mode} strategies. ` +
      `Available modes for this venue: ${availableModes(venue).join(", ")}`
    );
  }
  return engine;
}

function availableModes(venue: Venue): StrategyMode[] {
  const modes: StrategyMode[] = [];
  if (venue.engines.includes("freqtrade")) modes.push("classic");
  if (venue.engines.includes("nautilus")) modes.push("realtime");
  return modes;
}
```

Wizard flow:
1. User picks venue(s).
2. Wizard computes `availableModes(venues)` (intersection across selected venues).
3. User picks a strategy mode from the available set. If only one is available, it is pre-selected. If none are available, user is told to reselect venues.
4. Engine is derived and written to `desks.engine`, immutable thereafter.

See `strategies/venues.json` for the full list of venues and which engines each one supports.

## Docker Conventions

### Image pinning

Engine images are referenced by **pinned, immutable references** — either a version tag or a digest. **Never `:latest`**, and never anything else that can drift under your feet (e.g. a moving branch tag). Reproducibility of backtests depends on this: a saved `runs.commit_hash` + `runs.dataset_id` is only meaningful if the engine version is also fixed.

The current pinned references live in `packages/engines/src/images.ts`. That file is the single source of truth — do not duplicate the values here.

Bumping an image is a deliberate change that must be accompanied by fixture updates (parser fixtures, integration test baselines) in the same commit.

### Container labels

Every long-lived paper trading container is launched with labels so the server can reconcile state on restart via `docker ps`:

```
quantdesk.runId=<runId>
quantdesk.engine=freqtrade|nautilus
quantdesk.kind=paper
```

Backtest containers (ephemeral) don't need labels.

### Volumes

- `<workspacePath>` → `/workspace` (read-write, contains strategy code + config + data)
- Container logs redirected to `<workspacePath>/runs/<runId>/` so they survive container removal

### Network

- Outbound HTTPS allowed (public market data)
- No host network access
- No inbound ports except engine-specific status endpoints (Freqtrade REST API on a free port mapped to localhost)

### Resource limits

`--cpus`, `--memory`, `--pids-limit` per container to prevent runaway agent-generated code.

## Status Reception (per engine)

The `getPaperStatus()` interface hides per-engine differences:

| Engine | Mechanism |
|---|---|
| Freqtrade | Built-in REST API (`/api/v1/status`, `/api/v1/profit`) on a free port mapped to localhost |
| Nautilus | A small `runner.py` we ship subscribes to `MessageBus` and writes events as stdout JSONL; the server reads container stdout |

## Workspace Structure (per engine)

Each desk gets a git-initialized directory at `workspaces/desk-{id}/` for strategy code and data. The engine is fixed at desk creation, so the layout is engine-specific — never multi-engine within one desk.

### Freqtrade (`strategy_mode: classic`)

```
workspaces/desk-{id}/
  .git/
  strategy.py          # IStrategy subclass written by the agent
  config.json          # freqtrade config with `dry_run: true`, `dry_run_wallet`, REST API enabled
  data/                # downloaded OHLCV data (symlinks into the shared cache)
    binance_BTC-USDT_5m_2025-01-01_2026-01-01.json
  runs/<runId>/        # per-run logs and artifacts (mounted into container)
```

### Nautilus (`strategy_mode: realtime`)

```
workspaces/desk-{id}/
  .git/
  strategy.py          # Nautilus Strategy subclass with event handlers
  runner.py            # builds TradingNode with SandboxExecutionClient, emits MessageBus events as stdout JSONL
  config.py            # TradingNodeConfig (data clients, exec clients)
  data/                # downloaded tick / bar data
  runs/<runId>/
```

### Generic (fallback, backtest only)

```
workspaces/desk-{id}/
  .git/
  README.md            # describes the agent-written scripts
  backtest.{py,ts,js}  # agent-authored backtest script, emits NormalizedResult JSON to stdout
  download.{py,ts,js}  # agent-authored data download script
  data/
  runs/<runId>/
```

Generic desks **cannot run paper trading** — there is no paper entrypoint in the workspace and the UI disables the action.

## Generic Engine

For strategies/venues that don't fit Freqtrade or Nautilus (e.g. Kalshi prediction markets, custom venues). The agent writes both the strategy and the backtest scripts. Scripts run inside an ephemeral Python/Node container and must output `NormalizedResult` JSON to stdout.

```
ensureImage()       → pulls a generic python+node base image
downloadData()      → runs agent-written data download script in container
runBacktest()       → runs agent-written backtest script, parses stdout JSON
startPaper()        → throws "generic engine does not support paper trading"
stopPaper()         → throws
getPaperStatus()    → throws
```

Desks resolved to `generic` engine cannot enter paper trading. The UI disables the [Start Paper Trading] button with a tooltip explaining why.
