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
(trades, quotes, order-book deltas) rather than closed candles. The
workspace has a seeded \`strategy.py\` (and any related runner/config
files) whose imports and class structure define the framework contract
you must follow — read it before writing any code.

### Data acquisition
There is no server-side downloader for realtime desks — \`data_fetch\`
will return an error. Fetch the data yourself:

1. **Read \`strategy.py\` and its imports** to see which framework
   loads events for you, then inspect the framework's data layer
   (\`pip show <package>\` + Read on the source, or its docs) to learn
   the expected format, directory layout, and naming convention. Do
   not guess.
2. Write a fetcher script in the workspace (\`fetch_data.py\`, etc.)
   using whatever works for the venue: \`ccxt\`, venue REST/WebSocket
   APIs, the framework's own ingestion tooling. Tick-level data or
   book deltas are typical.
3. Run it via the Bash tool (\`run_in_background: true\` for slow
   downloads; poll with \`BashOutput\`).
4. Save the result in **exactly the format and location the framework
   reads from**, not a custom path of your own.
5. Call \`mcp__quantdesk__register_dataset\` so the server records the
   metadata. The framework will pick up the files transparently.

### Execution
Write / refine your strategy in \`strategy.py\` (preserving the seeded
imports and event-handler signatures) and call
\`mcp__quantdesk__run_backtest\` to execute it. The tool returns
\`{runId, runNumber, metrics[]}\` — react to the metrics on the same
turn. **Do not execute your strategy code yourself** — realtime
backtests must go through the tool so the server runs them in a
pinned, isolated container.`;
}
