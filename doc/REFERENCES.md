# References

## Paperclip

- https://github.com/paperclipai/paperclip
- AI agent orchestration platform. Our architecture (monorepo, AI CLI subprocess adapter, issue-based async interaction) is modeled after Paperclip.
- Key mappings: Company -> Desk, Issue -> Experiment, Issue Comment -> Comment

## Hipocampus

- https://github.com/kevin-hs-sohn/hipocampus
- File-based hierarchical memory compaction for AI agents (Raw -> Daily -> Weekly -> Monthly -> ROOT).
- We adapt the compaction concept to PostgreSQL: raw comments -> experiment summaries -> desk context. See `doc/architecture/MEMORY.md`.

## Freqtrade

- https://github.com/freqtrade/freqtrade
- Crypto trading bot framework. Backtesting engine adapter.
- Used for: data download, strategy execution, backtest result parsing.

## Nautilus Trader

- https://github.com/nautechsystems/nautilus_trader
- High-performance backtesting and trading framework. Backtesting engine adapter.
