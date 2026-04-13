# Engine Adapter

Pluggable interface for backtesting and paper trading engines. QuantDesk supports **two managed engines** plus a fallback:

- **Freqtrade** — for `classic` strategy mode (candle-based polling, TA indicators)
- **Nautilus Trader** — for `realtime` strategy mode (event-driven, tick-level)
- **Generic** — fallback for venues with no managed engine; runs agent-authored scripts inside a pinned Ubuntu+Python container

All engine processes run inside Docker containers using images with **pinned version tags**. The server, UI, and agent CLI run on the host — only the engine layer is containerized. See `CLAUDE.md` rules 6–12 for the binding constraints.

## Scope

The whitelist above is **approval-gated**: the default answer to "can we add engine X?" is no, and any addition requires explicit user approval per CLAUDE.md rule #7. In practice the generic engine covers most "I want to use venue X / framework Y" cases without requiring a new managed adapter — try that path first. Notably, no managed Hummingbot adapter is provided — users who need Hummingbot install it inside a generic-mode script (`pip install hummingbot` in the generic container). The generic engine exists precisely so unsupported frameworks can be used via agent-authored scripts without us maintaining dedicated adapters.

## Data download tools (per engine)

Each engine brings its own historical data download tool, invoked by the server when the agent calls the `data_fetch` MCP tool (see `../agent/MCP.md`):

| Engine | Download mechanism |
|---|---|
| `freqtrade` | Freqtrade `download-data` command run inside an ephemeral container |
| `nautilus` | Nautilus `DataCatalog` ingest run inside an ephemeral container |
| `generic` | Agent-authored download script executed inside the generic Ubuntu+Python container |

## Strategy Mode

Users never pick an engine directly. During onboarding they choose a **strategy mode**:

| Mode | Engine | Description |
|---|---|---|
| `classic` (recommended) | Freqtrade | Candle-based polling strategies, TA indicators, minute-to-hour timeframes. Best for trend following, mean reversion, momentum. |
| `realtime` (advanced) | Nautilus | Event-driven strategies reacting to ticks and order book deltas, sub-second timeframes. Best for market making, arbitrage, HFT. |

Each desk pins a `strategy_mode` at creation and the engine is derived from it — both immutable per CLAUDE.md rule #8.

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

`strategy_mode` has exactly two values: `classic` and `realtime`. The engine is derived from the `(strategy_mode, venue)` pair, not from `strategy_mode` alone. When the venue exposes a managed engine for the chosen mode, that managed engine is used. Otherwise the **generic engine is selected as a fallback** — the desk's `strategy_mode` stays `classic` or `realtime`, and the agent writes scripts that follow that mode's philosophy (candle-based for `classic`, event-driven for `realtime`) inside the generic Ubuntu+Python container.

```ts
type StrategyMode = "classic" | "realtime";
type EngineName = "freqtrade" | "nautilus" | "generic";

const MANAGED_ENGINE_FOR_MODE: Record<StrategyMode, EngineName> = {
  classic: "freqtrade",
  realtime: "nautilus",
};

function resolveEngine(venue: Venue, mode: StrategyMode): EngineName {
  const managed = MANAGED_ENGINE_FOR_MODE[mode];
  if (venue.engines.includes(managed)) return managed;
  return "generic"; // fallback — agent writes mode-flavoured scripts in the generic container
}
```

`generic` is therefore an **engine**, never a `strategy_mode`. It never appears in the wizard's mode picker; it is silently chosen by `resolveEngine` when no managed engine matches the venue.

Wizard flow:
1. User picks venue(s).
2. User picks a strategy mode (`classic` or `realtime`). Both modes are always available — there is no "no managed engine matches" dead end, because `generic` will catch it.
3. Engine is derived via `resolveEngine` and written to `desks.engine` (immutable per CLAUDE.md rule #8).

See `strategies/venues.json` for the full list of venues and which managed engines each one supports.

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

- `<workspacePath>` → `/workspace` (read-write, contains strategy code + config + cached data symlinks)
- Container logs redirected to `<workspacePath>/runs/<runId>/` so they survive container removal
- For each user-imported dataset declared on the desk, an additional **read-only bind mount** at container start: `<hostPath>` → `/workspace/data/external/<label>` (`:ro`). The set of mounts is read from the desk row on every container spawn (backtest and paper) so reconcile after a server restart re-applies the same mappings. See `../desk/STORAGE.md` "Workspace bootstrap" for the bootstrap path.

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

### Generic (fallback, agent-scripted — used when no managed engine matches the venue)

```
workspaces/desk-{id}/
  .git/
  README.md            # describes the agent-written scripts
  backtest.{py,ts,js}  # agent-authored backtest script, emits NormalizedResult JSON to stdout
  download.{py,ts,js}  # agent-authored data download script
  paper.{py,ts,js}     # agent-authored long-running paper loop script
  data/
  runs/<runId>/
```

## Generic Engine

For venues that don't fit Freqtrade or Nautilus (e.g. Kalshi prediction markets, custom venues). The desk's `strategy_mode` is still `classic` or `realtime` — the user picked one of those in the wizard — and the agent writes scripts that follow that mode's philosophy: candle-based polling for `classic`, event-driven for `realtime`. Backtest scripts must output a `NormalizedResult` JSON object as the **last line** of stdout.

Unlike Freqtrade and Nautilus, the generic engine ships its own image (`ghcr.io/0xbet-ai/quantdesk-generic:<pinned>`, defined in `docker/generic/Dockerfile`) that bundles five runtimes: **python3, node, bun, rust, go**. Every agent-authored script — backtest, fetcher, anything else — runs inside this one image so the host stays untouched regardless of the user's OS.

**Image distribution.** The image is published to GitHub Container Registry as a multi-arch (amd64 + arm64) build via the `docker-generic.yml` GitHub Actions workflow. It is pulled automatically during `npx quantdesk onboard`. For local development:

```bash
pnpm build:generic-image
# → docker build -t ghcr.io/0xbet-ai/quantdesk-generic:0.1.0 docker/generic/
```

`GenericAdapter.ensureImage()` pulls the image from the registry (idempotent — a no-op if already present), matching Freqtrade and Nautilus adapter behaviour.

```
ensureImage()       → pulls ghcr.io/0xbet-ai/quantdesk-generic from registry
downloadData()      → NOT implemented — the agent writes a fetcher
                      script, runs it via the `run_script` MCP tool
                      (inside the sandbox), then calls register_dataset
runScript()         → runContainer(quantdesk/generic, volumes=[workspace,
                      caches], command=[runtime, scriptPath]) — returns
                      raw { stdout, stderr, exitCode } without parsing
runBacktest()       → same container recipe, but parses the LAST line
                      of stdout as NormalizedResult and persists a runs
                      row with the metrics
startPaper()        → not yet supported on generic desks
```

`runScript` exists precisely so the agent has a sandboxed path for every side-effecting script it writes. The `mode-generic` prompt forbids running agent-authored scripts via the `Bash` tool — `Bash` is reserved for workspace housekeeping (`ls`, `cat`, `git`), and any `python3` / `node` / `cargo run` invocation must go through `run_script` or `run_backtest` so it stays inside the container.

### Dependency declaration

Agents declare third-party packages in the standard manifest file for the chosen runtime, placed at the workspace root. The container entrypoint auto-installs them before running the script:

| Runtime | Manifest | Install command (inside container) |
|---|---|---|
| python | `requirements.txt` | `pip install -r requirements.txt` |
| node / bun | `package.json` | `npm install` |
| rust | `Cargo.toml` (standard layout) | `cargo run` (fetches + compiles) |
| go | `go.mod` | `go run` (fetches transitively) |

Package-manager caches are mounted from `~/.quantdesk/generic-cache/{pip,npm,cargo,go-build,gopath}` on the host so the first install is slow but every subsequent run is fast.

### Supported script extensions

| Extension | Runtime |
|---|---|
| `.py` | `python3` |
| `.js`, `.mjs`, `.cjs` | `node` |
| `.ts` | `bun` |
| `.rs` | `cargo run --release --quiet` (requires `Cargo.toml` + `src/main.rs`) |
| `.go` | `go run` |

Any other extension is rejected by `runBacktest` with `UnsupportedRuntimeError`.
