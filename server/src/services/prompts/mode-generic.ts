/**
 * `analyst.mode-generic` — generic engine fallback (agent-authored
 * scripts, host execution).
 *
 * Paper trading is **explicitly disallowed** for generic desks — the
 * prompt must tell the agent to never call `go_paper` / `run_paper` tools
 * here.
 */

export function buildGenericModeBlock(): string {
	return `## Execution Model: Generic (agent-authored scripts, host execution)

This desk uses a venue without a managed engine, so you write and run the
backtest script yourself. This is the explicit opt-out from container
isolation — the script runs on the host Node/Python.

### Data acquisition
There is **no server-side data fetcher** for generic desks. Do **not** call
\`mcp__quantdesk__data_fetch\` — the server has no pre-packaged downloader
for this mode and the tool will return an error. Fetch data yourself:

1. Write a fetcher script in the workspace (\`fetch_data.py\`, \`fetch.ts\`,
   whatever fits the venue) using \`ccxt\`, the venue's REST API via
   \`requests\`, the venue's SDK, The Graph for on-chain DEXes, etc.
2. Run it via the Bash tool with \`run_in_background: true\` for slow
   fetches and poll with \`BashOutput\` so progress streams to the user.
3. Save the result to \`./data/<exchange>/<pair>-<timeframe>.csv\` (or
   \`.json\`). Path is up to you; be consistent.
4. Call \`mcp__quantdesk__register_dataset\` so the server registers it:

\`\`\`
mcp__quantdesk__register_dataset({
  "exchange": "<id>",
  "pairs": ["BTC/USDT"],
  "timeframe": "5m",
  "dateRange": {"start": "2025-01-01", "end": "2025-03-01"},
  "path": "<path to saved file>"
})
\`\`\`

### Backtest execution
Generic mode still uses the \`mcp__quantdesk__run_backtest\` tool — the
server runs your entrypoint script and parses its stdout for a JSON
metrics line. Write a standalone script (Python, JS, whatever fits the
venue) that:

1. Uses pandas + ta (or equivalent) for indicators. Always use **real**
   market data fetched above — never synthetic or random.
2. Prints a JSON metrics object to stdout as the LAST line of output.

Then call:

\`\`\`
mcp__quantdesk__run_backtest({
  "strategyName": "<your strategy class or name>",
  "entrypoint": "<path/to/your/entrypoint.py>"
})
\`\`\`

The tool blocks until the script finishes and returns
\`{runId, runNumber, metrics[]}\`.

### Metrics schema
The last-line JSON your script prints must have a \`metrics\` array. Pick
4–8 metrics that best characterise the strategy's performance; always
include at least one return-like metric for sorting. Order by importance.

\`\`\`
{
  "metrics": [
    {"key": "return",   "label": "Return",        "value": <number>, "format": "percent", "tone": "positive"},
    {"key": "drawdown", "label": "Max Drawdown",  "value": <number>, "format": "percent", "tone": "negative"},
    {"key": "sharpe",   "label": "Sharpe Ratio",  "value": <number>, "format": "number"},
    {"key": "trades",   "label": "Total Trades",  "value": <number>, "format": "integer"}
  ]
}
\`\`\`

Field reference:
- \`key\`: short identifier (snake_case or camelCase)
- \`label\`: human-readable name shown in the UI
- \`value\`: numeric value (raw number, not formatted string)
- \`format\`: one of \`percent\` | \`number\` | \`integer\` | \`currency\`
- \`tone\` (optional): \`positive\` (green when value > 0), \`negative\` (red), \`neutral\` (default)

### Paper trading
**Paper trading is not supported** for generic desks. Do **not** call the
paper-trading tools and do not ask the user about paper trading. Only
backtest workflows are allowed here.`;
}
