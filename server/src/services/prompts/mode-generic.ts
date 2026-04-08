/**
 * `analyst.mode-generic` — generic engine fallback (agent-authored
 * scripts, host execution).
 *
 * Paper trading is **explicitly disallowed** for generic desks — the
 * prompt must tell the agent to never emit `[PROPOSE_GO_PAPER]` here.
 */

export function buildGenericModeBlock(): string {
	return `## Execution Model: Generic (agent-authored scripts, host execution)

This desk uses a venue without a managed engine, so you write and run the
backtest script yourself. This is the explicit opt-out from container
isolation — the script runs on the host Node/Python.

### Data acquisition
There is **no server-side data fetcher** for generic desks. Do **not** emit
\`[PROPOSE_DATA_FETCH]\` — the server has no pre-packaged downloader to run
for this mode. Fetch data yourself:

1. Write a fetcher script in the workspace (\`fetch_data.py\`, \`fetch.ts\`,
   whatever fits the venue) using \`ccxt\`, the venue's REST API via
   \`requests\`, the venue's SDK, The Graph for on-chain DEXes, etc.
2. Run it via the Bash tool with \`run_in_background: true\` for slow
   fetches and poll with \`BashOutput\` so progress streams to the user.
3. Save the result to \`./data/<exchange>/<pair>-<timeframe>.csv\` (or
   \`.json\`). Path is up to you; be consistent.
4. Emit a \`[DATASET]\` marker so the server registers it:

\`\`\`
[DATASET]
{"exchange": "<id>", "pairs": ["BTC/USDT"], "timeframe": "5m", "dateRange": {"start": "2025-01-01", "end": "2025-03-01"}, "path": "<path to saved file>"}
[/DATASET]
\`\`\`

### Backtest execution
1. Write the strategy as a standalone script in the workspace (Python, JS,
   whatever fits the venue). Use pandas + ta (or equivalent) for indicators.
   Always use **real** market data fetched above — never synthetic or random.
2. For long-running commands (data downloads, backtests, optimizations), run
   them in the background and poll for progress so the user can see what is
   happening:
   - Use the Bash tool with \`run_in_background: true\`. Returns a shell ID
     immediately instead of blocking.
   - Make sure your script flushes stdout line-by-line. In Python use
     \`print(..., flush=True)\` or run with \`python -u\`. In other
     languages, ensure line-buffered output (e.g. wrap with \`stdbuf -oL\`).
   - Poll the running shell with \`BashOutput(bash_id=…)\` every few seconds
     until it finishes. Each poll appends new stdout to the same UI card.
   - Avoid single foreground commands that take more than ~30 seconds — the
     user sees only "Waiting for result..." until they finish.
3. Print a JSON result to stdout as the LAST line of output, then wrap it
   in your response as:

\`\`\`
[BACKTEST_RESULT]
{"metrics": [...]}
[/BACKTEST_RESULT]
\`\`\`

### Metrics schema
The result must be a JSON object with a \`metrics\` array. Pick 4–8 metrics
that best characterise the strategy's performance; always include at least
one return-like metric for sorting. Order by importance.

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
**Paper trading is not supported** for generic desks. Do **not** emit
\`[RUN_PAPER]\` or propose \`[PROPOSE_GO_PAPER]\`. Only backtest workflows
are allowed here.`;
}
