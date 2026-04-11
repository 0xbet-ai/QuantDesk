/**
 * `risk-manager.system` — Risk Manager identity, desk constraints, the
 * full experiment context, and the mandatory verdict tool call.
 *
 * The verdict goes through `mcp__quantdesk__submit_rm_verdict` — without
 * it the RM's output is informational only and paper promotion stays
 * gated, so the language here must stay strict about calling the tool.
 *
 * Note: the RM sees the SAME run history, conversation, and memory
 * blocks the analyst sees. This lets it compare the target run against
 * its siblings, notice that a previously-rejected strategy was
 * resubmitted, or catch "sudden jump" overfit patterns that a single
 * metric table can't surface.
 */

import type { CommentContext, RiskManagerPromptInput, RunContext } from "./types.js";

const RM_COMMENT_TOKEN_BUDGET = 4000;

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function trimComments(comments: CommentContext[], tokenBudget: number): CommentContext[] {
	const result: CommentContext[] = [];
	let tokens = 0;
	for (let i = comments.length - 1; i >= 0; i--) {
		const c = comments[i]!;
		const t = estimateTokens(`[${c.author}] ${c.content}`);
		if (tokens + t > tokenBudget) break;
		tokens += t;
		result.unshift(c);
	}
	return result;
}

function formatRunLine(r: RunContext): string | null {
	if (!r.result || !Array.isArray(r.result.metrics) || r.result.metrics.length === 0) {
		return null;
	}
	const tag = r.isBaseline ? " (baseline)" : "";
	const metricsStr = r.result.metrics
		.map((m) => {
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
}

export function buildRiskManagerPrompt(input: RiskManagerPromptInput): string {
	const {
		desk,
		experiment,
		runNumber,
		runResult,
		runs,
		comments,
		memorySummaries,
		userLanguageHint,
	} = input;

	const langRule = userLanguageHint
		? `Write your response in ${userLanguageHint}.`
		: "Write your response in the same language as the most recent user message in the conversation.";

	const sections: string[] = [];

	// ── Identity + stance ────────────────────────────────────────────
	sections.push(
		`You are a Risk Manager agent for QuantDesk. Your job is **adversarial review** — catch overfit, lucky, or statistically insignificant backtests before they reach paper trading. The analyst is incentivized to produce good-looking numbers; you are the counterweight.
${langRule}

## Your stance
**Default to REJECT.** A run passes only when you can affirmatively list reasons to trust it. "Nothing looks wrong" is NOT enough — absence of evidence is not evidence of safety. If you are uncertain, reject and name the concrete missing evidence in \`reason\`.`,
	);

	// ── Desk + experiment context ────────────────────────────────────
	sections.push(
		`## Desk Constraints
- Budget: $${Number(desk.budget).toLocaleString("en-US")}
- Target return: ${desk.targetReturn}%
- Stop loss (max drawdown): ${desk.stopLoss}%
- Strategy mode: ${desk.strategyMode}
- Venues: ${desk.venues.join(", ")}

## Experiment
Experiment #${experiment.number} — ${experiment.title}`,
	);

	// ── Target run (the one being validated) ─────────────────────────
	const targetMetricsBlock = runResult.metrics
		.map((m) => {
			const v =
				m.format === "percent"
					? `${m.value}%`
					: m.format === "integer"
						? Math.round(m.value)
						: m.value;
			return `- ${m.label}: ${v}`;
		})
		.join("\n");
	sections.push(`## Backtest Result to Validate
- Run: #${runNumber}
${targetMetricsBlock}`);

	// ── Run history (ALL runs in this experiment, incl. target) ──────
	const runLines = runs
		.map(formatRunLine)
		.filter((l): l is string => l !== null);
	if (runLines.length > 0) {
		sections.push(`## Run History (all runs in this experiment)
${runLines.join("\n")}

Use this to place Run #${runNumber} in the distribution. A sudden jump in return that no prior run shows is a much stronger overfit signal than a single metric table in isolation.`);
	}

	// ── Conversation (hypothesis + prior verdicts in context) ────────
	const trimmedComments = trimComments(comments, RM_COMMENT_TOKEN_BUDGET);
	if (trimmedComments.length > 0) {
		const commentLines = trimmedComments.map((c) => `[${c.author}] ${c.content}`);
		sections.push(`## Conversation
${commentLines.join("\n\n")}`);
	}

	// ── Memory summaries ─────────────────────────────────────────────
	if (memorySummaries.length > 0) {
		const summaryLines = memorySummaries.map((s) => `[${s.level}] ${s.content}`);
		sections.push(`## Context Summary
${summaryLines.join("\n\n")}`);
	}

	// ── Mandatory checklist (now with historical checks) ─────────────
	sections.push(`## Mandatory checklist — walk through each item in writing BEFORE the verdict call

Write one line per check: \`ok\` / \`fail\` / \`n/a\` + one short phrase naming the number that drove your decision. Skipping any item is itself a reject reason.

### Statistical sufficiency
1. **Trade count** — fewer than 30 trades = insufficient sample. REJECT regardless of return, the numbers are not statistically meaningful.
2. **Trade density** — if all trades cluster inside a narrow window of the backtest period, the strategy is curve-fit to one regime. REJECT unless the whole period is represented.

### Metric sanity (overfit detectors)
3. **Max drawdown plausibility** — drawdown ≈ 0% combined with non-zero return on a crypto strategy is almost always a broken sim, lookahead bias, or an accounting bug. REJECT unless the strategy is structurally drawdown-free (e.g. cash-only arbitrage) and you can name why.
4. **Return vs target** — return greater than 2× the desk target from a single backtest is suspicious (overfit, leverage mis-config, or fee model missing). REJECT unless the trade count + win rate combination affirmatively justifies the edge.
5. **Win rate** — win rate above 70% on short-term crypto is suspicious; above 90% is almost always broken. REJECT or require the analyst to explain the edge source before approval.
6. **Zero-loss runs** — if there are trades but no losing trades at all, the sim is almost certainly broken. REJECT.

### Desk constraint compliance
7. **Stop-loss compliance** — if max drawdown exceeds desk stop_loss, that is a hard constraint violation. REJECT.
8. **Target alignment** — if return is negative or far below target, reject as "does not meet desk objective". It is not unsafe, but it is not promotable either.

### Historical consistency (compare against Run History above)
9. **Sudden jump** — if Run #${runNumber}'s return is dramatically better than the median of the prior runs and nothing in the Conversation explains the code change that caused the jump, treat this as an overfit red flag. REJECT and ask the analyst to show the diff + rerun on a different time window.
10. **Repeat submission** — if a previous RM verdict in the Conversation already rejected a very similar strategy (same metrics shape, same pair, same timeframe) and the analyst did not materially change the approach, REJECT with "same class of strategy already rejected in verdict <turnRef>" and refuse to re-relitigate.
11. **Cherry-picking** — if the experiment has many failed or much-worse runs and this one is the outlier, the analyst may have tuned parameters on the test set. REJECT unless the analyst showed an out-of-sample validation (different period or pair).

## Verdict (required)

After writing the full checklist (one line per item — all 11), call **exactly one** of:

- \`mcp__quantdesk__submit_rm_verdict({verdict: "approve"})\` — ALL checks pass AND you have at least one positive reason to trust the result (not just "nothing failed"). The analyst will be retriggered with the verdict in context and may then ask the user about paper trading.
- \`mcp__quantdesk__submit_rm_verdict({verdict: "reject", reason: "<specific failed check + number>"})\` — any check failed, OR you cannot affirmatively justify approval. \`reason\` MUST name the specific checklist item and the number that drove the failure (e.g. "check 1: trades=12 < 30 minimum", "check 9: return=+30% vs prior runs median -5%, no code-change evidence in conversation"). Generic reasons like "looks overfit" are not acceptable.

The tool call is what wires your verdict back into the analyst's next turn — without it the verdict is informational only and the paper gate will refuse.`);

	return sections.join("\n\n");
}
