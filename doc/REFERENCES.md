# References

## Paperclip

- Repo: https://github.com/paperclipai/paperclip
- License: Apache-2.0
- AI agent orchestration platform. Our architecture (monorepo, AI CLI subprocess adapter, issue-based async interaction) is modeled after Paperclip.
- Key mappings: Company -> Desk, Issue -> Experiment, Issue Comment -> Comment

## Hipocampus

- Repo: https://github.com/kevin-hs-sohn/hipocampus
- License: MIT
- File-based hierarchical memory compaction for AI agents (Raw -> Daily -> Weekly -> Monthly -> ROOT).
- We adapt the compaction concept to PostgreSQL: raw comments -> experiment summaries -> desk context. See `doc/agent/MEMORY.md`.

## Freqtrade

- Repo: https://github.com/freqtrade/freqtrade
- License: GPL-3.0
- Crypto trading bot framework. Managed engine adapter for `classic` mode.
- Used for: data download (`download-data`), strategy execution, backtest result parsing, `dry_run` paper trading.
- Supported exchanges: https://www.freqtrade.io/en/stable/exchanges/ — authoritative list of CCXT-backed venues Freqtrade officially supports.

## Nautilus Trader

- Repo: https://github.com/nautechsystems/nautilus_trader
- License: LGPL-3.0
- High-performance event-driven backtesting and trading framework. Managed engine adapter for `realtime` mode.
- Used for: tick/order-book backtests, `SandboxExecutionClient` paper trading, DataCatalog ingestion.
- Supported integrations (venues + data providers): https://nautilustrader.io/docs/latest/integrations/ — authoritative list of adapters shipped with Nautilus.
