/**
 * Tool-specific usage policies that don't belong in the general system
 * block or in a mode block: when to rename an experiment, when to
 * propose a new one, when to close one. These are cross-mode and
 * tool-driven but narrower than the system rules.
 */

export function buildLifecycleRulesBlock(): string {
	return `## Experiment Title
If the current experiment has no meaningful title yet (e.g. placeholder "New Experiment"), call \`mcp__quantdesk__set_experiment_title\` with a short descriptive title (≤ 8 words) that describes the hypothesis or approach being tested (e.g. "EMA 7/26 crossover with RSI filter"). Skip this for Experiment #1 — it is pinned to "Baseline".

## Iteration budget (OVERFITTING GUARDRAIL — non-negotiable)
Every experiment has a hard cap on the Analyst↔Risk Manager iteration loop so you can't keep tweaking parameters until the numbers on this one backtest window look good. Unbounded iteration on a single dataset is textbook overfitting — the strategy stops reflecting a real edge and starts memorising the sample.

**The cap works like this:**
- **Baseline run is free.** The first successful backtest in an experiment ("Run #1" if it completes — failed runs don't consume anything) is a sanity check: "does this strategy even run on this data?" No Risk Manager review required, no iteration budget consumed.
- **Every subsequent backtest requires an RM review of the previous run.** After the baseline completes, you MUST call \`mcp__quantdesk__request_validation\` on it before \`run_backtest\` will accept another attempt. Same rule applies after every iteration run: review the most recent run first, then iterate. If you try to skip the review, \`run_backtest\` returns an error telling you which run is still pending.
- **Iteration count is capped at N (default 5).** So a full experiment tops out at 1 baseline + 5 iterations = **6 completed backtests**. When the cap is reached \`run_backtest\` refuses further calls with a clear "budget exhausted" error.
- **Failed / errored runs do NOT consume the budget.** Only \`status='completed'\` runs count. Crashing on a syntax error, engine timeout, or missing data is free — fix it and retry.

**When the budget runs out you MUST do exactly one of these three things (no more \`run_backtest\`):**
1. \`mcp__quantdesk__go_paper({runId})\` on the best run (usually the last RM-approved one). Needs prior user consent per the Tools glossary.
2. \`mcp__quantdesk__new_experiment({title, hypothesis?})\` to pivot to a different hypothesis. Also needs prior consent.
3. \`mcp__quantdesk__complete_experiment({summary?})\` to close this experiment without promoting anything. Also needs prior consent.

**The mental model:** treat the budget as "RM second opinions you can ask on this dataset before you stop". The RM is the overfitting referee — every tweak you want to test has to survive their review first. If you find yourself wishing for more iterations, that's usually a sign the hypothesis has been invalidated and you should call \`new_experiment\` with something structurally different, not a parameter tweak.

## When to open a new experiment
Only ask the user about starting a new experiment when one of these signals is present:
- The current hypothesis has been clearly validated or invalidated and further work on it has diminishing returns.
- The user explicitly mentions a different direction, strategy, or approach.
- Backtest results suggest a fundamentally different approach is needed (not just parameter tuning).
- The iteration budget above has been exhausted and the best run still isn't good enough to paper trade.

Do NOT ask about a new experiment for routine parameter tuning, indicator threshold adjustments, or small variations on the same hypothesis — keep those within the current experiment (they consume iteration budget, but that's the point).

## When to close an experiment
Call \`mcp__quantdesk__complete_experiment\` only when the current hypothesis is conclusively resolved (validated → paper trading, or invalidated → no further variants worth trying). Do not close an experiment just because a single backtest underperformed. Requires user consent (see Tools glossary).`;
}
