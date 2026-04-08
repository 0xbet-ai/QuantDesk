# Agent Roles

## Analyst

Fetches data, writes/modifies strategy code, runs backtests, manages paper trading, posts results as comments.

The Analyst writes code appropriate to the desk's pinned `strategy_mode`. Per-mode workspace layout, entrypoints, and the script/class contracts the Analyst must follow live in `../engine/README.md` — that is the single source of truth for engine-shaped concerns.

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
