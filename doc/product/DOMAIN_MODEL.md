# Domain Model

## Desk

One strategy workspace.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | User-defined name |
| budget | NUMERIC | Capital allocation (USD) |
| target_return | NUMERIC | Target return % per backtest period |
| stop_loss | NUMERIC | Max acceptable drawdown % |
| strategy_id | TEXT? | Catalog strategy ID (nullable for custom) |
| venues | JSONB | Selected venues, e.g. `["binance"]` or `["binance", "uniswap"]` |
| engine | TEXT | Resolved by agent: `freqtrade`, `hummingbot`, `nautilus`, `generic` |
| config | JSONB | Default params — pairs, timeframe, etc. |
| description | TEXT? | Strategy description |
| status | TEXT | `active` / `archived` |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

## Experiment

A thread of work within a desk. Agent proposes new Experiments when direction changes significantly; user approves.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| desk_id | UUID | FK -> desks |
| number | INTEGER | Sequential within desk |
| title | TEXT | e.g. "ADX Baseline", "Timeframe Study" |
| description | TEXT? | What this experiment is exploring |
| status | TEXT | `active` / `completed` / `archived` |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

## Run

A single backtest or live trading execution within an Experiment.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| experiment_id | UUID | FK -> experiments |
| run_number | INTEGER | Sequential within experiment |
| is_baseline | BOOLEAN | True for first run in each experiment |
| mode | TEXT | `backtest` / `live` |
| status | TEXT | `pending` / `running` / `completed` / `stopped` / `failed` |
| config | JSONB | Override params for this run (merged with desk defaults) |
| result | JSONB | Return, drawdown, win_rate, trades |
| commit_hash | TEXT | Git commit hash in desk workspace |
| dataset_id | UUID? | FK -> datasets (backtest only) |
| error | TEXT? | Error message if failed |
| created_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ? | |

## Run Log

Individual events within a Run. Backtest runs have trade logs; live runs additionally have pnl snapshots, errors, and status changes.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| run_id | UUID | FK -> runs |
| type | TEXT | `trade` / `pnl` / `error` / `status` |
| data | JSONB | Event data (price, quantity, pnl, etc.) |
| created_at | TIMESTAMPTZ | |

## Dataset

Reusable market data. Multiple runs can share the same dataset. Owned by desk.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| desk_id | UUID | FK -> desks |
| exchange | TEXT | e.g. `binance` |
| pairs | JSONB | e.g. `["BTC/USDT"]` |
| timeframe | TEXT | e.g. `5m` |
| date_range | JSONB | `{ "start": "...", "end": "..." }` |
| path | TEXT | Filesystem path to downloaded data |
| created_at | TIMESTAMPTZ | |

## Comment

Comments on an Experiment. User posts a comment, agents reply async (not real-time).

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| experiment_id | UUID | FK -> experiments |
| author | TEXT | `user` / `analytics` / `risk_manager` |
| content | TEXT | Markdown |
| run_id | UUID? | FK -> runs (if tied to a specific run) |
| metadata | JSONB | Token usage, model, cost, etc. |
| created_at | TIMESTAMPTZ | |

## Agent Session

Persists AI CLI session for `--resume`. Scoped to desk (shared across experiments).

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| desk_id | UUID | FK -> desks |
| agent_role | TEXT | `analytics` / `risk_manager` |
| session_id | TEXT | AI CLI session ID |
| total_cost | NUMERIC | Accumulated cost |
| updated_at | TIMESTAMPTZ | |

## Memory Summary

Schema for long-term context compaction. See `doc/architecture/MEMORY.md` for how it works.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| desk_id | UUID | FK -> desks |
| level | TEXT | `experiment` / `desk` |
| experiment_id | UUID? | FK -> experiments (for experiment-level) |
| content | TEXT | Compressed summary |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

## Venue Catalog

Curated venue tags in `strategies/venues.json`. Each entry has: id, name, type (`cex`, `dex`, `prediction`), engines (which engines support this venue).

Used for:
- Wizard Step 2: multi-select chips for venue selection
- Strategy catalog filtering: show only strategies whose engine supports selected venues
- Engine resolution: narrows engine candidates for the agent

Custom venues added via "+ Add" default to `generic` engine.

## Strategy Catalog

Curated templates in `strategies/` directory, one JSON file per engine (`freqtrade.json`, `hummingbot.json`, `nautilus.json`). Seeded into DB on first run.

Each entry has: id, name, category, difficulty, description, indicators, default_params, timeframes, engine, source URL.

Categories: `trend_following`, `mean_reversion`, `momentum`, `ml_based`, `market_making`, `arbitrage`, `prediction_market`.

See `doc/architecture/ENGINE_ADAPTER.md` for supported engines.

When no catalog strategy is selected, the agent writes the strategy from scratch using the desk's configured engine.
