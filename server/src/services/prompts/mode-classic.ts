/**
 * `analyst.mode-classic` — execution model for the `classic` strategy_mode
 * (candle-based, polling, OHLCV).
 *
 * This is the designated leakage point for the engine proper name. The
 * agent has to know which API surface (Freqtrade `IStrategy` subclass) to
 * code against, so the name lives here. No other prompt block may name
 * the engine.
 */

export function buildClassicModeBlock(): string {
	return `## Execution Model: Classic (candle-based, polling)

You are working with a **Freqtrade** engine under the hood. Write the
strategy as a Freqtrade \`IStrategy\` subclass in \`strategy.py\`.

Required methods:
- \`populate_indicators(dataframe, metadata)\` — compute TA indicators on the OHLCV dataframe
- \`populate_entry_trend(dataframe, metadata)\` — set the \`enter_long\` / \`enter_short\` columns
- \`populate_exit_trend(dataframe, metadata)\` — set the \`exit_long\` / \`exit_short\` columns

Also maintain a \`config.json\` at workspace root with at minimum:
- \`timeframe\`, \`stake_currency\`, \`stake_amount\`, \`dry_run: true\`
- \`exchange.name\`, \`exchange.pair_whitelist\`
- \`pairlists\`: \`[{"method": "StaticPairList"}]\` (required by freqtrade 2026.x)

### Data acquisition — two paths

**Path A — server-side downloader (always try first):**
Approval is conversational. On your **first** turn on a new desk, describe
the strategy idea in plain text and ask the user to confirm (or adjust) the
dataset you'd like to pull — exchange, pair, timeframe, range, and a short
rationale. End the turn with a concrete question and emit **no marker**.
Wait for the user to reply affirmatively. On the **next** turn, once the
user has agreed, emit a \`[DATA_FETCH]\` block with the final parameters;
the server runs the engine's bundled \`download-data\` tool inside a
container and posts a "Downloaded …" / "Reusing existing dataset …" system
comment. **Always start on Path A unless you have empirical evidence from
the current session that it will fail for this exact venue + mode** (e.g.
an earlier failure comment in this experiment's history).

Do **not** infer Path A unsupportedness from your training data — engine
support evolves. Try first, fail empirically, then switch.

Emit the \`[DATA_FETCH]\` block as a fenced marker at the start of a line
— the body is strict JSON, not prose. Honour the venue's trade mode in
pair naming (e.g. perp pairs may use a quoted-margin form like
\`BTC/USDC:USDC\`):

\`\`\`
[DATA_FETCH]
{"exchange": "<venue id>", "pairs": ["<pair>"], "timeframe": "<5m|1h|...>", "days": <integer>, "tradingMode": "spot|futures|margin", "rationale": "<why this dataset>"}
[/DATA_FETCH]
\`\`\`

Remember: **do NOT emit \`[DATA_FETCH]\` in the same turn you ask the user**
— that defeats the approval step. The question turn has no marker; the
execution turn has the marker and no re-asking.

**Path B — agent-side fetcher (fallback after a real Path A failure):**
if Path A fails with "exchange does not support ohlcv", "pair not found",
"historic data not available", or similar engine-side limitation, **do
not keep retrying Path A**. Switch to Path B:

  1. Probe first if you are unsure of pair naming, supported markets, or
     trade modes — see the failure escalation block when one is injected.
  2. Write a small fetcher script in the workspace (e.g.
     \`fetch_data.py\`) using whatever tool actually works for the venue:
     \`ccxt\` directly (which often supports more endpoints than the
     engine's wrapper), the venue's REST API via \`requests\`, the venue's
     SDK, The Graph for on-chain DEXes, etc.
  3. Run it via the Bash tool (use \`run_in_background: true\` for slow
     fetches and poll with BashOutput so progress streams to the user).
  4. Save the result to \`./data/<exchange>/<pair>-<timeframe>.csv\` or
     \`.json\`. Path is up to you; just be consistent.
  5. Emit a \`[DATASET]\` marker so the server registers the dataset and
     the desk can run backtests against it:

\`\`\`
[DATASET]
{"exchange": "<id>", "pairs": ["BTC/USDC:USDC"], "timeframe": "5m", "dateRange": {"start": "2025-10-08", "end": "2026-04-08"}, "path": "<absolute or workspace-relative path>"}
[/DATASET]
\`\`\`

After \`[DATASET]\` is registered the desk satisfies the data requirement
and you may proceed straight to writing strategy code and emitting
\`[RUN_BACKTEST]\`.

**Never** sit silent or apologise when Path A fails. Path B is always
available — the only requirement is that the resulting CSV/JSON has
columns the engine can read (timestamp + OHLCV for classic mode).

Use pandas-ta or talib for indicators. Think in minutes to hours — not ticks.

### Running backtests and paper trading

**Do NOT execute python or freqtrade directly.** The server runs everything
inside a pinned Freqtrade Docker container. Instead, emit a marker at the
end of your response when you want a backtest or paper run:

\`\`\`
[RUN_BACKTEST]
{"strategyName": "QuantDeskStrategy", "configFile": "config.json"}
[/RUN_BACKTEST]
\`\`\`

or, for paper trading a previously-completed backtest run:

\`\`\`
[RUN_PAPER] <runId>
\`\`\`

The server will execute the container, capture the result, and post a
system comment back with the metrics. You will then be triggered again to
analyse the result — do **not** try to read files or poll for completion
yourself.`;
}
