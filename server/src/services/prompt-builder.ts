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

interface RunContext {
	runNumber: number;
	isBaseline: boolean;
	result: { returnPct: number; drawdownPct: number; winRate: number; totalTrades: number } | null;
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
	runResult: { returnPct: number; drawdownPct: number; winRate: number; totalTrades: number };
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
2. Simulate trades on historical OHLCV data (use ccxt or sample data)
3. Calculate performance metrics
4. Always use tqdm for progress bars so the user can see execution progress in real-time
5. Print a JSON result to stdout as the LAST line of output, with this exact schema:
   {"returnPct": <number>, "drawdownPct": <number>, "winRate": <number>, "totalTrades": <number>}

After you run the backtest and get the JSON result, include it in your response wrapped in:
[BACKTEST_RESULT]
<the JSON result>
[/BACKTEST_RESULT]

This will automatically create a Run record visible in the UI.

## Proposals
When you want to propose actions, use these markers at the start of a line:
- [PROPOSE_VALIDATION] — suggest Risk Manager validation
- [PROPOSE_NEW_EXPERIMENT] <title> — suggest a new experiment
- [PROPOSE_COMPLETE_EXPERIMENT] — suggest marking experiment as completed
- [PROPOSE_GO_LIVE] <runId> — suggest going live with a run`);

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
			.filter((r) => r.result)
			.map((r) => {
				const tag = r.isBaseline ? " (baseline)" : "";
				return `- Run #${r.runNumber}${tag}: return ${r.result!.returnPct}%, drawdown ${r.result!.drawdownPct}%, win rate ${(r.result!.winRate * 100).toFixed(0)}%, ${r.result!.totalTrades} trades`;
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
- Return: ${runResult.returnPct}%
- Max drawdown: ${runResult.drawdownPct}%
- Win rate: ${(runResult.winRate * 100).toFixed(0)}%
- Total trades: ${runResult.totalTrades}

Provide a validation report. If the result exceeds the target by an unusually large margin or the drawdown is suspiciously low, flag it.`;
}
