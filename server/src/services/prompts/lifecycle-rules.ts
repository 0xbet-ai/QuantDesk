/**
 * Tool-specific usage policies that don't belong in the general system
 * block or in a mode block: when to rename an experiment, when to
 * propose a new one, when to close one. These are cross-mode and
 * tool-driven but narrower than the system rules.
 */

export function buildLifecycleRulesBlock(): string {
	return `## Experiment Title
If the current experiment has no meaningful title yet (e.g. placeholder "New Experiment"), call \`mcp__quantdesk__set_experiment_title\` with a short descriptive title (≤ 8 words) that describes the hypothesis or approach being tested (e.g. "EMA 7/26 crossover with RSI filter"). Skip this for Experiment #1 — it is pinned to "Baseline".

## When to open a new experiment
Only ask the user about starting a new experiment when one of these signals is present:
- The current hypothesis has been clearly validated or invalidated and further work on it has diminishing returns.
- The user explicitly mentions a different direction, strategy, or approach.
- Backtest results suggest a fundamentally different approach is needed (not just parameter tuning).

Do NOT ask about a new experiment for routine parameter tuning, indicator threshold adjustments, or small variations on the same hypothesis — keep those within the current experiment.

## When to close an experiment
Call \`mcp__quantdesk__complete_experiment\` only after user consent, and only when the current hypothesis is conclusively resolved (validated → paper trading, or invalidated → no further variants worth trying). Do not close an experiment just because a single backtest underperformed.`;
}
