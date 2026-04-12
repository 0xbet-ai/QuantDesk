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

import type {
	AnalystTrailChunk,
	CodeDiffContext,
	CommentContext,
	RiskManagerPromptInput,
	RunContext,
} from "./types.js";

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

function formatCodeDiffBlock(diff: CodeDiffContext | null | undefined): string | null {
	if (!diff) return null;
	// Nothing to compare against — baseline with no prior run, or the
	// only commit in the repo. Still emit a short note so the RM knows
	// the absence isn't a bug.
	if (!diff.againstPrevious && !diff.againstBaseline) {
		if (!diff.targetCommit) return null;
		return `## Strategy Code Changes
_No code diff available for this run — it is the baseline (or the only commit in the workspace). Judge the strategy as a whole from the analyst reasoning trail + conversation below._`;
	}

	const parts: string[] = ["## Strategy Code Changes"];
	parts.push(
		"The backtest metrics above came out of the code below. Read the diff and use it when you apply checks #9 (sudden jump) and #11 (cherry-picking) — a big metric swing with a one-line parameter tweak is very different from a big swing with a structural rewrite.",
	);

	if (diff.againstPrevious) {
		parts.push(
			`### ${diff.previousLabel ?? "vs previous run"}\n\`\`\`diff\n${diff.againstPrevious}\n\`\`\``,
		);
	}
	if (diff.againstBaseline) {
		parts.push(
			`### ${diff.baselineLabel ?? "vs baseline"}\n\`\`\`diff\n${diff.againstBaseline}\n\`\`\``,
		);
	}
	if (diff.truncated) {
		parts.push(
			"_One or both diffs were truncated to fit the prompt budget. If you need to see a specific file in full, reject with a `reason` that names the file so the analyst can resubmit a smaller change._",
		);
	}
	return parts.join("\n\n");
}

function formatAnalystTrailBlock(trail: AnalystTrailChunk[] | null | undefined): string | null {
	if (!trail || trail.length === 0) return null;

	const lines: string[] = [
		"## Analyst Reasoning Trail",
		"These are the analyst's most recent `thinking`, `tool_call`, and `text` chunks pulled from this turn's JSONL transcript — what it was working on *right before* it asked you to validate. Use it to judge intent (was this a deliberate edit or a flailing parameter sweep?) and to apply checks #10 (repeat submission) and #11 (cherry-picking).",
	];
	for (const chunk of trail) {
		if (chunk.type === "thinking") {
			lines.push(`- **[thinking]** ${chunk.content}`);
		} else if (chunk.type === "tool_call") {
			lines.push(`- **[tool_call ${chunk.name ?? "?"}]** ${chunk.content}`);
		} else {
			lines.push(`- **[text]** ${chunk.content}`);
		}
	}
	return lines.join("\n");
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
		codeDiff,
		analystTrail,
		userLanguageHint,
	} = input;

	// The RM system prompt is dense English (checklist, verdict tool,
	// desk constraints). Without an explicit language instruction the
	// LLM drifts to English even when the analyst and the user have
	// been writing in Korean, because English context dominates. The
	// hint is resolved server-side in agent-runner.ts via a fallback
	// chain (user msg → desk description → analyst msg); if that still
	// returns nothing, instruct the LLM to read the conversation below
	// and match the analyst's most recent message so the RM never
	// unilaterally switches the thread's language to English.
	const langRule = userLanguageHint
		? `**Write your entire response in ${userLanguageHint}.** This includes the checklist lines, the verdict prose, and any rejection reasons. The only things that stay in their original form are tool call arguments, metric labels, pair symbols, and other proper nouns. Do NOT switch to English just because this system prompt is in English.`
		: "**Write your response in the same language the analyst has been using in the Conversation section below.** Read the analyst's most recent message and match its language exactly. If the conversation is in Korean, reply in Korean; if English, English. Do NOT switch to English just because this system prompt is in English.";

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
	const runLines = runs.map(formatRunLine).filter((l): l is string => l !== null);
	if (runLines.length > 0) {
		sections.push(`## Run History (all runs in this experiment)
${runLines.join("\n")}

Use this to place Run #${runNumber} in the distribution. A sudden jump in return that no prior run shows is a much stronger overfit signal than a single metric table in isolation.`);
	}

	// ── Strategy code diff (what changed between this run and prior) ─
	const codeDiffBlock = formatCodeDiffBlock(codeDiff);
	if (codeDiffBlock) sections.push(codeDiffBlock);

	// ── Analyst reasoning trail (last turn's thinking + tool calls) ──
	const analystTrailBlock = formatAnalystTrailBlock(analystTrail);
	if (analystTrailBlock) sections.push(analystTrailBlock);

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

### Historical consistency (compare against Run History + Strategy Code Changes + Analyst Reasoning Trail above)
9. **Sudden jump** — if Run #${runNumber}'s return is dramatically better than the median of the prior runs, read the **Strategy Code Changes** block: a one-line threshold tweak cannot plausibly explain a 3× return jump, so that pattern = overfit red flag → REJECT. A structural change (new indicator, new gate, risk-model swap) CAN justify a jump, but only if the **Analyst Reasoning Trail** shows the analyst understood why — a diff with no matching reasoning is still a reject. If the diff is empty / unchanged, the jump is almost always a sim or data artefact → REJECT.
10. **Repeat submission** — if a previous Risk Manager verdict in the Conversation already rejected a very similar strategy (same metrics shape, same pair, same timeframe), cross-check with the **Analyst Reasoning Trail** and the **Strategy Code Changes** diff: if neither shows a materially different approach, REJECT with "same class of strategy already rejected in verdict <turnRef>" and refuse to re-relitigate. A rename / formatting refactor is NOT a material change.
11. **Cherry-picking** — if the experiment has many failed or much-worse runs and this one is the outlier, read the **Analyst Reasoning Trail** for evidence of out-of-sample validation (different period or pair). If the trail shows the analyst only tuned parameters against the same backtest window, REJECT. If the diff adds parameter tweaks *without* any out-of-sample check, REJECT.

## Verdict (required)

After writing the full checklist (one line per item — all 11), call **exactly one** of:

- \`mcp__quantdesk__submit_rm_verdict({verdict: "approve"})\` — ALL checks pass AND you have at least one positive reason to trust the result (not just "nothing failed"). The analyst will be retriggered with the verdict in context and may then ask the user about paper trading.
- \`mcp__quantdesk__submit_rm_verdict({verdict: "reject", reason: "<specific failed check + number>"})\` — any check failed, OR you cannot affirmatively justify approval. \`reason\` MUST name the specific checklist item and the number that drove the failure (e.g. "check 1: trades=12 < 30 minimum", "check 9: return=+30% vs prior runs median -5%, no code-change evidence in conversation"). Generic reasons like "looks overfit" are not acceptable.

The tool call is what wires your verdict back into the analyst's next turn — without it the verdict is informational only and the paper gate will refuse.`);

	return sections.join("\n\n");
}
