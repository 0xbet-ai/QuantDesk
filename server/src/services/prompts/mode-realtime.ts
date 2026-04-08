/**
 * `analyst.mode-realtime` — execution model for the `realtime` strategy_mode
 * (event-driven, tick-level).
 *
 * Same engine-name leakage allowance as `mode-classic`: the agent has to
 * code against a specific API surface, so the name appears here.
 */

export function buildRealtimeModeBlock(): string {
	return `## Execution Model: Real-time (event-driven, tick-level)

You are working with a **Nautilus Trader** engine under the hood. Write
the strategy as a Nautilus \`Strategy\` subclass in \`strategy.py\` with
event handlers:

- \`on_start(self)\` — subscribe to data (\`subscribe_quote_ticks\`, \`subscribe_order_book_deltas\`, \`subscribe_bars\`)
- \`on_quote_tick(self, tick)\` — react to new best bid/ask
- \`on_trade_tick(self, tick)\` — react to prints
- \`on_order_book_delta(self, delta)\` — react to book updates
- \`on_order_filled(self, event)\` — handle own fills

Create orders via \`self.order_factory\` (market, limit, post-only, OCO…).
Use Nautilus indicator objects (\`ExponentialMovingAverage\`, \`RelativeStrengthIndex\`, …)
and feed them via \`handle_bar\` / \`handle_tick\`.

The workspace also needs a \`runner.py\` — the default one emits JSONL
status events on stdout; feel free to extend it to wire your strategy into
the TradingNode.

### Data acquisition
There is **no server-side data fetcher** for realtime desks yet — the
generic \`[PROPOSE_DATA_FETCH]\` path only runs for classic mode. Do **not**
emit \`[PROPOSE_DATA_FETCH]\`; the server will post a system comment telling
you it is unsupported and nothing will happen. Fetch the data yourself:

1. Write a fetcher script in the workspace (e.g. \`fetch_data.py\`) using
   \`ccxt\`, the venue's REST/WebSocket API, or Nautilus's own data catalog
   ingestion tooling. Tick data and order book deltas are typically what
   realtime strategies need.
2. Run it via the Bash tool. Use \`run_in_background: true\` for slow
   downloads and poll with \`BashOutput\`.
3. Save the result under \`./data/\` in a layout Nautilus can ingest
   (Parquet/catalog is typical; document the path in your script).
4. Emit a \`[DATASET]\` marker so the server registers the dataset:

\`\`\`
[DATASET]
{"exchange": "<id>", "pairs": ["BTC/USDT"], "timeframe": "tick", "dateRange": {"start": "2025-01-01", "end": "2025-01-07"}, "path": "<workspace-relative path>"}
[/DATASET]
\`\`\`

After \`[DATASET]\` is registered the desk satisfies the data requirement
and you may proceed to writing the strategy and emitting \`[RUN_BACKTEST]\`.

### Running backtests and paper trading

**Do NOT execute python directly.** The server runs runner.py inside a
pinned Nautilus Docker container. Emit markers to request execution:

\`\`\`
[RUN_BACKTEST]
{"strategyName": "QuantDeskStrategy"}
[/RUN_BACKTEST]
\`\`\`

or, for paper trading a previously-completed backtest run:

\`\`\`
[RUN_PAPER] <runId>
\`\`\`

The server will execute the container and post a system comment with the
result. You will be re-triggered for analysis — do not poll or read files
yourself.`;
}
