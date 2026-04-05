# Agent Roles

## Analytics

Fetches data, writes/modifies strategy code, runs backtests, posts results as comments.

If results look anomalous (e.g. unrealistic returns, suspicious drawdown), proposes Risk Manager validation to the user.

## Risk Manager

Validates results against desk config, flags overfitting/bias, posts validation report.

Only runs when:
- User explicitly requests validation
- Analytics detects anomalies and proposes validation -> user approves

## Interaction Pattern

All agent actions that go beyond the current task follow the same pattern: **agent suggests -> user approves -> action**.

Examples:
- New Experiment: "This seems like a different direction. Start a new Experiment?"
- Risk validation: "Results look unusual. Run Risk Manager validation?"
- Data re-download: "Data might be stale. Re-download?"

## New Experiment Criteria

Agent proposes a new Experiment when:
- Strategy logic itself changes (ADX -> Bollinger Bands)
- Completely different pair/market
- Current experiment concluded, moving to next phase

Stay in the same Experiment for:
- Parameter tuning (ADX period 14 -> 21)
- Adding/removing filters on the same strategy
- Re-running with same data

## Execution Flow

See `doc/architecture/AGENT_EXECUTION.md` for technical details.
