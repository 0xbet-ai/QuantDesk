# Agent Roles

## Analyst

Resolves engine from desk venues + strategy description, fetches data, writes/modifies strategy code, runs backtests, manages paper trading, posts results as comments.

If results look anomalous, proposes Risk Manager validation to the user. Anomaly detection is left to the agent's judgment — no fixed thresholds.

## Risk Manager

Validates results against desk config, flags overfitting/bias, posts validation report.

Only runs when:
- User explicitly requests validation
- Analyst detects anomalies and proposes validation -> user approves

## Interaction Pattern

All agent actions that go beyond the current task follow the same pattern: **agent suggests -> user approves -> action**.

All proposals are presented as button UI (Approve / Decline). No comment-based approval.

Examples:
- New Experiment: "This seems like a different direction. Start a new Experiment?"
- Complete Experiment: "This experiment has converged. Mark as completed?"
- Risk validation: "Results look unusual. Run Risk Manager validation?"
- Data re-download: "Data might be stale. Re-download?"
- Start paper trading: "Backtest looks solid. Start paper trading?"

## New Experiment Criteria

Agent proposes a new Experiment when:
- Strategy logic itself changes (ADX -> Bollinger Bands)
- Completely different pair/market
- Current experiment concluded, moving to next phase

Stay in the same Experiment for:
- Parameter tuning (ADX period 14 -> 21)
- Adding/removing filters on the same strategy
- Re-running with same data

## Proposal Protocol

Agent uses structured markers in comment output to propose actions:

| Marker | Action |
|--------|--------|
| `[PROPOSE_VALIDATION]` | Suggest Risk Manager validation |
| `[PROPOSE_NEW_EXPERIMENT] <title>` | Suggest creating a new experiment |
| `[PROPOSE_COMPLETE_EXPERIMENT]` | Suggest marking current experiment as completed |
| `[PROPOSE_GO_PAPER] <run_id>` | Suggest starting paper trading with a backtest run |

Format: marker tag at start of line, space, then value (everything after the space). No braces.

Server detects markers → shows proposal UI to user → user approves/declines via button.

## Execution Flow

See `doc/architecture/AGENT_EXECUTION.md` for technical details.
