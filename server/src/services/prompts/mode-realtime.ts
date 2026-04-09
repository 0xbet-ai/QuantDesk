/**
 * `analyst.mode-realtime` — execution model for the `realtime` strategy_mode
 * (event-driven, tick/orderbook level).
 *
 * Engine-agnostic. The framework contract lives in the seeded
 * \`strategy.py\` (and any runner/config files next to it); the agent
 * discovers it by reading those files. Do NOT name engines, data file
 * formats, catalog layouts, or native extensions here.
 */

export function buildRealtimeModeBlock(): string {
	return `## Execution Model: Real-time (event-driven, tick/orderbook)

Realtime mode is for strategies that react to individual market events
(trades, quotes, order-book deltas) rather than closed candles.

### Data acquisition
There is no server-side downloader for realtime desks — \`data_fetch\`
will return an error. Go directly to Path B (see the Tools glossary).
Tick-level data or book deltas are typical for this mode.

### Execution
Write / refine your strategy in \`strategy.py\` (preserving the seeded
imports and event-handler signatures) and call \`run_backtest\` to
execute it. React to the returned metrics on the same turn. For
auxiliary scripts (fetchers, exploration), use \`run_script\`.`;
}
