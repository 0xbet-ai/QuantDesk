/**
 * `analyst.mode-generic` — generic execution model (agent-authored
 * scripts, no managed framework).
 *
 * Paper trading is **explicitly disallowed** for generic desks.
 */

export function buildGenericModeBlock(): string {
	return `## Execution Model: Generic (agent-authored)

This desk has no managed framework — you write both the strategy and
the backtest entrypoint from scratch. Structure the code however best
fits the venue and hypothesis. Pick the language that best fits the
venue (Python for most quant work, Node/bun if the venue has a strong
JS SDK, Rust/Go for perf-sensitive or native-SDK cases).

### Data acquisition
Follow the "Data acquisition" steps in the Tools glossary: design your
strategy approach first, determine the data format it needs, describe
your data plan to the user, wait for confirmation, then fetch and
register.

### Backtest execution
Write a standalone entrypoint that loads the fetched data (always
**real** market data, never synthetic), runs the strategy logic, and
prints a JSON metrics object as the LAST line of stdout (see "Backtest
metrics schema" in the Tools glossary). Then call \`run_backtest\` with
the entrypoint path. React to the returned metrics on the same turn.`;
}
