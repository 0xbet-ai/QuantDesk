interface DeskContext {
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
	strategyMode: "classic" | "realtime";
	engine: string;
	venues: string[];
	description: string | null;
}

interface ExperimentContext {
	number: number;
	title: string;
}

interface MetricEntry {
	key: string;
	label: string;
	value: number;
	format: string;
	tone?: string;
}

interface RunContext {
	runNumber: number;
	isBaseline: boolean;
	result: { metrics: MetricEntry[] } | null;
}

interface CommentContext {
	author: string;
	content: string;
}

interface MemorySummary {
	level: string;
	content: string;
}

interface AnalystPromptInput {
	desk: DeskContext;
	experiment: ExperimentContext;
	runs: RunContext[];
	comments: CommentContext[];
	memorySummaries: MemorySummary[];
	isResume?: boolean;
}

interface RiskManagerPromptInput {
	desk: DeskContext;
	runResult: { metrics: MetricEntry[] };
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Count consecutive failure system comments at the *tail* of the comment
 * thread. Used by `buildAnalystPrompt` to inject persistence pressure into
 * the next prompt — the more failures in a row, the more emphatic the
 * escalation. Stops counting at the first non-failure comment so a single
 * old failure doesn't poison every future turn.
 *
 * Marker-agnostic: any system comment whose body matches the failure
 * pattern counts, no matter which lifecycle stage it came from
 * (data-fetch, backtest, validation, etc.).
 */
export function countRecentFailureStreak(comments: CommentContext[]): number {
	let n = 0;
	// Walk from the tail. Failure system comments increment the streak.
	// Other system comments (progress like "Downloading..." or success like
	// "Downloaded ...") are *transparent* — they neither break nor add to
	// the streak. Only a non-system comment (user / analyst / risk_manager)
	// or an explicit success marker terminates the count, because that is
	// the moment a real "fresh start" happened.
	for (let i = comments.length - 1; i >= 0; i--) {
		const c = comments[i]!;
		if (c.author !== "system") return n;
		if (/\b(?:fail(?:ed|ure)?|error)\b/i.test(c.content)) {
			n++;
			continue;
		}
		// "Downloaded N file(s)" / "Reusing existing dataset" = success → reset.
		if (
			/\b(?:downloaded|reusing existing dataset|backtest run #\d+ completed)\b/i.test(c.content)
		) {
			return n;
		}
		// Neutral progress comment → skip without affecting the streak.
	}
	return n;
}

/**
 * Build the persistence-pressure block injected at the top of the analyst
 * prompt when there is a recent failure streak. Returns an empty string if
 * `streak === 0` so the normal prompt is unchanged.
 */
export function buildFailureEscalationBlock(streak: number): string {
	if (streak === 0) return "";
	return `## RECENT FAILURE STREAK: ${streak}

GIVING UP IS NOT AN OPTION. The previous ${streak} attempt(s) failed. You
are in a retry loop and the server WILL re-trigger you until you produce a
valid action marker. Bare acknowledgments in ANY language — "OK", "Sure",
"Sorry", "I'll stop here", "Understood", or any plain-text wrap-up without
a marker — are SPEC VIOLATIONS (CLAUDE.md rule #15) and will be
auto-rejected by the server's dead-end guard, which will then re-prompt
you with the same situation.

You must NOT:
- repeat parameters that just failed
- end the turn with a plain-text apology and no marker
- ask the user a vague open-ended question

You MUST end this turn with one of the following, in priority order:

1. A corrected proposal marker with a fundamentally different approach,
   not a one-character tweak.

2. Only if every plausible path is ruled out: a multiple-choice question
   to the user with concrete labelled options.

Persist. Try every fundamental variant and every workaround before
escalating. The server will keep waking you up until something works.`;
}

export function trimCommentsToTokenBudget(
	comments: CommentContext[],
	tokenBudget: number,
): CommentContext[] {
	const result: CommentContext[] = [];
	let tokens = 0;

	for (let i = comments.length - 1; i >= 0; i--) {
		const comment = comments[i]!;
		const commentTokens = estimateTokens(`[${comment.author}] ${comment.content}`);
		if (tokens + commentTokens > tokenBudget) break;
		tokens += commentTokens;
		result.unshift(comment);
	}

	return result;
}

function buildModeInstructions(desk: DeskContext): string {
	// The engine is derived from strategy mode by the server. Don't expose
	// the engine name to the user, but the agent needs to know which engine
	// API to code against.
	if (desk.strategyMode === "classic") {
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

### Data acquisition — two paths, in priority order

**Path A — server-side downloader (preferred for major CEXs):**
\`[PROPOSE_DATA_FETCH]\` asks the user to approve a dataset; on approve the
server runs the engine's bundled \`download-data\` tool inside a container.
This is the easy path for venues the engine knows (Binance, Bybit, OKX,
Kraken, etc.).

**Path B — agent-side fetcher (use whenever Path A fails or the venue is
not supported):** if \`[PROPOSE_DATA_FETCH]\` fails with a "exchange does
not support ohlcv", "pair not found", "historic data not available", or
similar engine-side limitation, **do not keep retrying Path A**. Switch
to Path B:

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

	if (desk.strategyMode === "realtime") {
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

	// Generic fallback — agent runs scripts directly on the host.
	return `## Execution Model: Generic (agent-authored scripts, host execution)

This desk uses a venue without a managed engine, so you write and run the
backtest script yourself. This is the explicit opt-out from container
isolation — the script runs on the host Node/Python.

1. Write the strategy as a standalone script in the workspace (Python, JS,
   whatever fits the venue).
2. Execute it with the Bash tool. The script must output a NormalizedResult
   JSON to stdout and wrap it in:
   \`[BACKTEST_RESULT] {...} [/BACKTEST_RESULT]\`
3. **Paper trading is not supported** for generic desks. Do **not** propose
   \`[PROPOSE_GO_PAPER]\`. Only backtest workflows are allowed here.`;
}

export function buildAnalystPrompt(input: AnalystPromptInput): string {
	const { desk, experiment, runs, comments, memorySummaries } = input;

	const sections: string[] = [];

	// System instructions
	sections.push(`You are an Analyst agent for QuantDesk.
You research, write strategy code, run backtests, and analyze results.

## Rules
- Do NOT repeat or echo back previous conversation messages. Only provide your new response.
- Do NOT include [user], [system], or [analyst] prefixes in your output.
- Write your response in the user's language (match the language of the most recent user message).
- Keep responses concise and focused on the task.

## Workspace
You are working inside a git repository (the current working directory).
You can create, edit, and execute files freely using the available tools.
Write strategy code and backtest scripts here.

## Backtest Execution
Write a Python backtest script and execute it. The script should:
1. Implement the strategy logic using pandas and ta (technical analysis library)
2. Always use real market data. Choose the data type the strategy requires (OHLCV, tick, orderbook, funding rate, OI, etc.) and fetch it via ccxt or other appropriate libraries. Never use synthetic or random data.
3. Calculate performance metrics
4. For long-running commands (data downloads, backtests, optimizations), run them in the background and poll for progress so the user can see what is happening:
   - Use the Bash tool with run_in_background: true. This returns a shell ID immediately instead of blocking.
   - Make sure your script flushes stdout line-by-line so progress shows up in real time. In Python use print(..., flush=True) or run with python -u. In other languages, ensure line-buffered output (e.g. wrap with stdbuf -oL).
   - Poll the running shell with BashOutput(bash_id=...) every few seconds until the script finishes. Each poll appends new stdout to the same card in the UI.
   - When the shell exits, the final BashOutput call returns the complete result. Continue with the next step (parsing, etc.).
   - Avoid single foreground commands that take more than ~30 seconds — the user sees only "Waiting for result..." until they finish.
5. Print a JSON result to stdout as the LAST line of output

The result must be a JSON object with a "metrics" array. Choose the metrics that are most relevant to the strategy you ran — different strategies have different important metrics (e.g. arbitrage cares about Sharpe and slippage, market making cares about inventory turnover and spread capture, trend following cares about return and max drawdown).

Schema:
{
  "metrics": [
    {"key": "return", "label": "Return", "value": <number>, "format": "percent", "tone": "positive"},
    {"key": "drawdown", "label": "Max Drawdown", "value": <number>, "format": "percent", "tone": "negative"},
    {"key": "sharpe", "label": "Sharpe Ratio", "value": <number>, "format": "number"},
    {"key": "trades", "label": "Total Trades", "value": <number>, "format": "integer"}
  ]
}

Field reference:
- key: short identifier (snake_case or camelCase)
- label: human-readable name shown in the UI
- value: numeric value (raw number, not formatted string)
- format: one of "percent" | "number" | "integer" | "currency"
- tone (optional): "positive" (green when value > 0), "negative" (red), "neutral" (default)

Pick 4-8 metrics that best characterize the strategy's performance. Always include at least one return-like metric (for sorting). Order them by importance.

After you run the backtest and get the JSON result, include it in your response wrapped in:
[BACKTEST_RESULT]
<the JSON result>
[/BACKTEST_RESULT]

This will automatically create a Run record visible in the UI.

## Dataset Registration
When you download market data, save it to a CSV file in the workspace and include a dataset marker in your response:
[DATASET]
{"exchange": "<exchange name>", "pairs": ["BTC/USDT"], "timeframe": "5m", "dateRange": {"start": "2025-01-01", "end": "2025-03-01"}, "path": "<path to saved CSV file>"}
[/DATASET]

This registers the dataset in the UI so the user can see what data was used.

## Response Formatting
Always use proper Markdown in your responses:
- Tables: use | col1 | col2 | format with header separators
- Lists: use - item or 1. item
- Metrics and key numbers: use **bold**
- Code: use fenced code blocks with language tags

## Experiment Title
If the current experiment has no meaningful title yet (e.g. placeholder "New Experiment"), start your first response with a line in the format:
[EXPERIMENT_TITLE] <short descriptive title, max 8 words>

The title should clearly describe the hypothesis or approach being tested (e.g. "EMA 7/26 crossover with RSI filter").

## First-run data fetch (MANDATORY for new desks)
If the workspace contains no strategy code yet AND no dataset has been registered for this desk, your FIRST response must produce a registered dataset by EITHER Path A (\`[PROPOSE_DATA_FETCH]\`) OR Path B (agent-side fetcher → \`[DATASET]\`) — see the "Data acquisition — two paths" section in your mode-specific instructions. Do NOT write strategy code or emit [RUN_BACKTEST] before a dataset is registered.

**Decision rule:**
- Major CEXs (Binance / Bybit / OKX / Kraken / Coinbase / etc.) → start with Path A.
- DEXes / on-chain venues / niche exchanges where the engine's bundled downloader is known to fail (Hyperliquid OHLCV, GMX, Uniswap pools, prediction markets, etc.) → skip directly to Path B. Do not waste a turn on a Path A you already expect to fail.

**Path A — \`[PROPOSE_DATA_FETCH]\` flow:** decide the venue, pair naming (honouring the venue's trade mode — e.g. Hyperliquid perps use \`BTC/USDC:USDC\`), timeframe, and history window, then emit:

[PROPOSE_DATA_FETCH]
{"exchange": "<venue id>", "pairs": ["<pair>"], "timeframe": "<5m|1h|...>", "days": <integer>, "tradingMode": "spot|futures|margin", "rationale": "<why this dataset>"}
[/PROPOSE_DATA_FETCH]

**Tone for the first turn**: you do NOT have data yet, so do NOT announce
"I will backtest …" or any equivalent commitment in any language. Frame the prose strictly as a *proposal*: describe the
strategy idea you want to try and state that you first need the following
data to test it. The actual backtest only happens after a dataset is
registered.

After you emit this marker, STOP and wait. The user will approve or reject. On approval, the server will download the data and post a system comment ("Downloaded ..."). Only THEN should you proceed to author the strategy code and emit [RUN_BACKTEST].

**If Path A fails** (engine error, "exchange does not support ohlcv", "historic data not available", pair not found, etc.) — do NOT keep retrying Path A with tweaked parameters. Switch to Path B immediately: write a fetcher script using the venue's REST API or \`ccxt\` directly, save the data to the workspace, and emit \`[DATASET]\` to register it.

## Proposals
When you want to propose actions, use these markers at the start of a line:
- [PROPOSE_VALIDATION] — suggest Risk Manager validation
- [PROPOSE_NEW_EXPERIMENT] <title> — suggest a new experiment
- [PROPOSE_COMPLETE_EXPERIMENT] — suggest marking experiment as completed
- [PROPOSE_GO_PAPER] <runId> — suggest starting paper trading with a run

### When to propose a new experiment
Only propose [PROPOSE_NEW_EXPERIMENT] when one of these signals is present:
- The current hypothesis has been clearly validated or invalidated and further work on it has diminishing returns.
- The user explicitly mentions a different direction, strategy, or approach.
- Backtest results suggest a fundamentally different approach is needed (not just parameter tuning).

Do NOT propose a new experiment for routine parameter tuning, indicator threshold adjustments, or small variations on the same hypothesis — keep those within the current experiment.`);

	// Strategy-mode-specific execution instructions.
	// The mode is pinned at desk creation and immutable — the agent never
	// switches modes or picks an engine; it follows the contract below.
	sections.push(buildModeInstructions(desk));

	// Persistence pressure (rule #15 + ralph-loop pattern). When the tail of
	// the comment thread shows consecutive failure system comments, prepend
	// an escalation block so the agent does not give up after one bad
	// attempt. Marker-agnostic — applies to any failure (data-fetch,
	// backtest, etc.).
	const failureStreak = countRecentFailureStreak(comments);
	const escalation = buildFailureEscalationBlock(failureStreak);
	if (escalation) sections.push(escalation);

	// Desk context
	sections.push(`## Desk: ${desk.name}
${desk.description ?? ""}
- Budget: $${Number(desk.budget).toLocaleString("en-US")}
- Target return: ${desk.targetReturn}%
- Stop loss: ${desk.stopLoss}% (max drawdown)
- Strategy mode: ${desk.strategyMode}
- Venues: ${desk.venues.join(", ")}`);

	// Experiment
	sections.push(`## Currently working on Experiment #${experiment.number} — ${experiment.title}`);

	// Runs
	if (runs.length > 0) {
		const runLines = runs
			.filter((r) => r.result && Array.isArray(r.result.metrics) && r.result.metrics.length > 0)
			.map((r) => {
				const tag = r.isBaseline ? " (baseline)" : "";
				const metricsStr = r
					.result!.metrics.map((m) => {
						const v =
							m.format === "percent"
								? `${m.value}%`
								: m.format === "integer"
									? Math.round(m.value)
									: m.value;
						return `${m.label} ${v}`;
					})
					.join(", ");
				return `- Run #${r.runNumber}${tag}: ${metricsStr}`;
			});
		if (runLines.length > 0) {
			sections.push(`## Run History\n${runLines.join("\n")}`);
		}
	}

	// Memory summaries (before comments)
	if (memorySummaries.length > 0) {
		const summaryLines = memorySummaries.map((s) => `[${s.level}] ${s.content}`);
		sections.push(`## Context Summary\n${summaryLines.join("\n\n")}`);
	}

	// Comments: on resume, only send the latest user message (session already has history)
	// On first run, send the full conversation (trimmed to token budget)
	const userComments = comments.filter((c) => c.author !== "system");
	if (input.isResume) {
		const lastUserComment = [...userComments].reverse().find((c) => c.author === "user");
		if (lastUserComment) {
			sections.push(`## Latest Message\n${lastUserComment.content}`);
		}
	} else {
		const trimmedComments = trimCommentsToTokenBudget(userComments, 4000);
		if (trimmedComments.length > 0) {
			const commentLines = trimmedComments.map((c) => `[${c.author}] ${c.content}`);
			sections.push(`## Conversation\n${commentLines.join("\n\n")}`);
		}
	}

	return sections.join("\n\n");
}

export function buildRiskManagerPrompt(input: RiskManagerPromptInput): string {
	const { desk, runResult } = input;

	return `You are a Risk Manager agent for QuantDesk.
Validate the backtest results against desk constraints. Flag overfitting, bias, or unrealistic performance.

## Desk Constraints
- Budget: $${Number(desk.budget).toLocaleString("en-US")}
- Target return: ${desk.targetReturn}%
- Stop loss (max drawdown): ${desk.stopLoss}%

## Backtest Result to Validate
${runResult.metrics
	.map((m) => {
		const v =
			m.format === "percent"
				? `${m.value}%`
				: m.format === "integer"
					? Math.round(m.value)
					: m.value;
		return `- ${m.label}: ${v}`;
	})
	.join("\n")}

Provide a validation report. Look for signs of overfitting, unrealistic performance, suspiciously low drawdown, or returns that exceed the target by an unusually large margin.

## Verdict marker (required)

End your response with **exactly one** of the following lines:

- \`[RM_APPROVE]\` — the run is sound. The analyst may now propose paper trading via [PROPOSE_GO_PAPER].
- \`[RM_REJECT] <short reason>\` — the run looks unsafe (overfit, suspicious metrics, constraint violation, etc.). Paper trading is gated until a fresh validation passes.

The marker is what wires your verdict back into the analyst's next turn — without it the verdict is informational only and \`[RUN_PAPER]\` will refuse.`;
}
