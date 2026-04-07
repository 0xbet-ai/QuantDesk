# Workspace

Each desk gets a git-initialized directory for strategy code and data. The **engine is fixed at desk creation** (derived from `desk.strategy_mode`) so the workspace layout is engine-specific — never multi-engine within one desk.

## Structure (by engine)

### Freqtrade (`strategy_mode: classic`)

```
workspaces/desk-{id}/
  .git/
  strategy.py          # IStrategy subclass written by the agent
  config.json          # freqtrade config with `dry_run: true`, `dry_run_wallet`, REST API enabled
  data/                # downloaded OHLCV data
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

## Code Versioning

- Agent commits on every code change, tagged with Run ID
- `commit_hash` on Run record links to exact code version
- UI can show code/diff via comment when user requests

## Data Storage

- Engine downloads data to `workspaces/desk-{id}/data/`
- See `doc/product/DOMAIN_MODEL.md` (Dataset) for schema and reuse model
