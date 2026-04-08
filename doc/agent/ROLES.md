# Agent Roles

## Analyst

Asks the user about data fetches, writes/modifies strategy code, runs backtests, manages paper trading, posts results as comments. The Analyst never downloads data itself — it asks the user in plain text which dataset to pull, waits for the user to agree, and then on the next turn emits `[DATA_FETCH]`; the server then runs `engineAdapter.downloadData()` (see `./MARKERS.md` and CLAUDE.md rules #12 and #15).

The Analyst writes code appropriate to the desk's pinned `strategy_mode`. Per-mode workspace layout, entrypoints, and the script/class contracts the Analyst must follow live in `../engine/README.md` — that is the single source of truth for engine-shaped concerns.

If results look anomalous, the Analyst asks the user whether to run Risk Manager validation, and on the user's affirmative reply emits `[VALIDATION]` in the next turn. Anomaly detection is left to the agent's judgment — no fixed thresholds.

## Risk Manager

Validates results against desk config, flags overfitting/bias, posts validation report.

There is exactly one trigger path: the Analyst emits `[VALIDATION]` after the user has agreed in the preceding exchange. See `./MARKERS.md` under the `VALIDATION` entry. Whether the suggestion originated from the Analyst's own anomaly detection or from a user comment asking for validation is upstream context — at the protocol level both collapse to the same "ask → user agrees → `[VALIDATION]` → RM dispatch" flow. There is no separate "user explicit request" route that bypasses the marker.

## See also

- `./MARKERS.md` — marker glossary, truth table, and turn-to-turn lifecycle
- `./TURN.md` — how a single turn is executed (CLI subprocess, prompt, session)
