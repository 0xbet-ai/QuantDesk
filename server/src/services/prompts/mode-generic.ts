/**
 * `analyst.mode-generic` — generic execution model (agent-authored
 * scripts, no managed framework).
 *
 * Paper trading is **explicitly disallowed** for generic desks.
 */

export function buildGenericModeBlock(): string {
	return `## Execution Model: Generic (agent-authored)

This desk has no managed framework — you write both the strategy and
the backtest entrypoint from scratch. The seeded workspace may contain
a README but no \`strategy.py\` template; structure the code however
best fits the venue and hypothesis.

### Data acquisition
There is no server-side downloader for generic desks; \`data_fetch\`
will return an error. Fetch data yourself:

1. Write a fetcher script (\`fetch_data.py\`, \`fetch.ts\`, whatever
   fits) using \`ccxt\`, the venue's REST/SDK, The Graph for on-chain
   DEXes, etc.
2. Run it via the Bash tool (\`run_in_background: true\` for slow
   fetches; poll with \`BashOutput\`).
3. Save the result to a path and format your own entrypoint script
   will read back (you control both sides, so format is free).
4. Call \`mcp__quantdesk__register_dataset\` so the server records the
   metadata.

### Backtest execution
Write a standalone entrypoint (Python, JS, whatever fits) that:

1. Loads the data you fetched above. Always use **real** market data —
   never synthetic or random.
2. Runs the strategy logic.
3. Prints a JSON metrics object to stdout as the LAST line of output
   (see schema below).

Then call:

\`\`\`
mcp__quantdesk__run_backtest({
  "strategyName": "<your strategy class or name>",
  "entrypoint": "<path/to/your/entrypoint.py>"
})
\`\`\`

The tool blocks until the script finishes and returns
\`{runId, runNumber, metrics[]}\`. React to the metrics on the same
turn.

### Metrics schema
The last-line JSON your script prints must have a \`metrics\` array.
Pick 4–8 metrics that best characterise the strategy's performance;
always include at least one return-like metric. Order by importance.

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
**Paper trading is not supported** for generic desks. Do not ask the
user about paper trading and do not call paper-trading tools here.`;
}
