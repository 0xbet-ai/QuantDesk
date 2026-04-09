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

1. **Read \`strategy.py\` and any framework config** seeded into the
   workspace — these are the authoritative source for the framework
   contract. Do not try to \`pip show\` or import the framework from
   your shell: the framework is only installed inside the engine
   container, not on the host your \`Bash\` tool touches. If the
   seeded files leave you uncertain about the expected data format
   or directory layout, ask the user.
2. Write a fetcher script in the workspace (\`fetch_data.py\`, etc.)
   using whatever works for the venue: \`ccxt\`, venue REST/WebSocket
   APIs, etc. Tick-level data or book deltas are typical.
3. **Execute the fetcher with
   \`mcp__quantdesk__run_script({ scriptPath: "fetch_data.py" })\`** —
   that runs it inside the sandboxed generic container with the
   workspace mounted in. Never run agent-authored scripts via the
   \`Bash\` tool (\`python3 fetch.py\` etc.) — \`Bash\` touches the
   user's host, which is not your environment.
4. Save the result in **exactly the format and location the framework
   reads from**, not a custom path of your own. The workspace root IS
   the engine's user-data directory — do NOT create a \`user_data/\`
   subdirectory (that would double-nest inside the container). Read the
   seeded config to find the expected data path and file naming
   convention, then save there (e.g. \`data/<exchange>/PAIR-tf.json\`,
   flat, no sub-directories per pair).
5. Call \`mcp__quantdesk__register_dataset\` so the server records the
   metadata. The framework will pick up the files transparently.

### Execution
Write / refine your strategy in \`strategy.py\` (preserving the seeded
imports and event-handler signatures) and call
\`mcp__quantdesk__run_backtest\` to execute it. The tool returns
\`{runId, runNumber, metrics[]}\` — react to the metrics on the same
turn. **Do not execute your strategy code yourself** — realtime
backtests must go through \`run_backtest\`. For any auxiliary scripts
(fetchers, exploration), use \`mcp__quantdesk__run_script\`, never
\`Bash\`.`;
}
