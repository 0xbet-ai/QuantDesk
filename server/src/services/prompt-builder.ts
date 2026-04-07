interface DeskContext {
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
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
4. For long-running backtests, split execution into phases (e.g., data download, optimization, final backtest) and run each phase as a separate command so the user can see intermediate progress
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

## Proposals
When you want to propose actions, use these markers at the start of a line:
- [PROPOSE_VALIDATION] — suggest Risk Manager validation
- [PROPOSE_NEW_EXPERIMENT] <title> — suggest a new experiment
- [PROPOSE_COMPLETE_EXPERIMENT] — suggest marking experiment as completed
- [PROPOSE_GO_LIVE] <runId> — suggest going live with a run

### When to propose a new experiment
Only propose [PROPOSE_NEW_EXPERIMENT] when one of these signals is present:
- The current hypothesis has been clearly validated or invalidated and further work on it has diminishing returns.
- The user explicitly mentions a different direction, strategy, or approach.
- Backtest results suggest a fundamentally different approach is needed (not just parameter tuning).

Do NOT propose a new experiment for routine parameter tuning, indicator threshold adjustments, or small variations on the same hypothesis — keep those within the current experiment.`);

	// Desk context
	sections.push(`## Desk: ${desk.name}
${desk.description ?? ""}
- Budget: $${Number(desk.budget).toLocaleString("en-US")}
- Target return: ${desk.targetReturn}%
- Stop loss: ${desk.stopLoss}% (max drawdown)
- Engine: ${desk.engine}
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

Provide a validation report. Look for signs of overfitting, unrealistic performance, suspiciously low drawdown, or returns that exceed the target by an unusually large margin.`;
}
