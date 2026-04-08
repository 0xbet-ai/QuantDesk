# Agent Roles

## Analyst

Proposes data fetches, writes/modifies strategy code, runs backtests, manages paper trading, posts results as comments. The Analyst never downloads data itself — it emits `[PROPOSE_DATA_FETCH]` and waits for user approval; the server then runs `engineAdapter.downloadData()` (see `./MARKERS.md` row P1 and CLAUDE.md rule #13).

The Analyst writes code appropriate to the desk's pinned `strategy_mode`. Per-mode workspace layout, entrypoints, and the script/class contracts the Analyst must follow live in `../engine/README.md` — that is the single source of truth for engine-shaped concerns.

If results look anomalous, the Analyst proposes Risk Manager validation via `[PROPOSE_VALIDATION]`. Anomaly detection is left to the agent's judgment — no fixed thresholds.

## Risk Manager

Validates results against desk config, flags overfitting/bias, posts validation report.

There is exactly one trigger path: the Analyst emits `[PROPOSE_VALIDATION]` and the user approves it. See `./MARKERS.md` row P2. Whether the proposal originated from the Analyst's own anomaly detection or from a user comment asking for validation is upstream context — at the protocol level both collapse to the same P2 → approve → RM dispatch flow. There is no separate "user explicit request" route that bypasses the marker.

## See also

- `./MARKERS.md` — marker glossary, truth table, and turn-to-turn lifecycle
- `./TURN.md` — how a single turn is executed (CLI subprocess, prompt, session)
