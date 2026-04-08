# Agent Roles

## Analyst

Fetches data, writes/modifies strategy code, runs backtests, manages paper trading, posts results as comments.

The Analyst's code-writing behavior branches on `desk.strategy_mode`:

- **`classic` (Freqtrade)**: write `IStrategy` subclasses with `populate_indicators`, `populate_entry_trend`, `populate_exit_trend`. Use TA indicators (pandas-ta, talib). Candle-based logic.
- **`realtime` (Nautilus)**: write `Strategy` subclasses with event handlers (`on_quote_tick`, `on_order_book_delta`, `on_order_filled`). Use Nautilus indicator objects and `order_factory`. Event-driven logic.
- **`generic` (fallback)**: write agent-authored scripts (any language) executed inside a pinned Ubuntu+Python container. Backtest scripts emit `NormalizedResult` JSON to stdout; paper scripts run as long-lived processes emitting periodic state updates. Both follow the same marker flow as managed modes.

See `../engine/README.md` for the engine resolution rules and per-engine workspace layout.

If results look anomalous, proposes Risk Manager validation to the user. Anomaly detection is left to the agent's judgment — no fixed thresholds.

## Risk Manager

Validates results against desk config, flags overfitting/bias, posts validation report.

Only runs when:
- User explicitly requests validation
- Analyst detects anomalies and proposes validation -> user approves

## See also

- `./MARKERS.md` — full marker glossary (proposals + actions)
- `./TURN.md` — how a single turn is executed (CLI subprocess, prompt, session)
- `./LIFECYCLE.md` — turn-to-turn lifecycle and marker branching
