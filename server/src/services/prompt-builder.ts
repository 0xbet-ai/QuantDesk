/**
 * Prompt orchestrator. Each prompt block lives in its own file under
 * `./prompts/` and is documented in `doc/agent/PROMPTS.md`. This file
 * stays thin: it composes blocks in the order PROMPTS.md § Composition
 * defines, plus the per-turn helpers (`estimateTokens`,
 * `trimCommentsToTokenBudget`).
 */

import {
	buildAnalystSystemBlock,
	buildClassicModeBlock,
	buildFailureEscalationBlock,
	buildGenericModeBlock,
	buildRealtimeModeBlock,
	countRecentFailureStreak,
} from "./prompts/index.js";
import type { AnalystPromptInput, CommentContext, DeskContext } from "./prompts/index.js";

// Re-export so existing call sites that imported from prompt-builder.ts
// keep working without churn.
export {
	buildFailureEscalationBlock,
	buildRiskManagerPrompt,
	countRecentFailureStreak,
} from "./prompts/index.js";
export type {
	AnalystPromptInput,
	CommentContext,
	DeskContext,
	ExperimentContext,
	MemorySummary,
	MetricEntry,
	RiskManagerPromptInput,
	RunContext,
} from "./prompts/index.js";

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

/**
 * Pick the mode-specific block for a desk's pinned `strategy_mode`. The
 * mode is immutable per desk (CLAUDE.md rule #10) so this resolution is
 * stable for the desk's lifetime.
 */
function buildModeInstructions(desk: DeskContext): string {
	if (desk.strategyMode === "classic") return buildClassicModeBlock();
	if (desk.strategyMode === "realtime") return buildRealtimeModeBlock();
	return buildGenericModeBlock();
}

/**
 * Compose the analyst prompt by concatenating blocks in the order spec'd
 * in `doc/agent/PROMPTS.md` § Composition. Each block knows its own
 * invariants; this function only knows the order.
 */
export function buildAnalystPrompt(input: AnalystPromptInput): string {
	const { desk, experiment, runs, comments, memorySummaries } = input;

	const sections: string[] = [];

	// 1. analyst.system — identity, rules, marker glossary, first-run protocol
	sections.push(buildAnalystSystemBlock());

	// 2. analyst.mode-{classic|realtime|generic} — engine-shaped execution
	sections.push(buildModeInstructions(desk));

	// 3. analyst.failure-escalation — conditional ralph-loop pressure
	const failureStreak = countRecentFailureStreak(comments);
	const escalation = buildFailureEscalationBlock(failureStreak);
	if (escalation) sections.push(escalation);

	// 4. ## Desk
	sections.push(`## Desk: ${desk.name}
${desk.description ?? ""}
- Budget: $${Number(desk.budget).toLocaleString("en-US")}
- Target return: ${desk.targetReturn}%
- Stop loss: ${desk.stopLoss}% (max drawdown)
- Strategy mode: ${desk.strategyMode}
- Venues: ${desk.venues.join(", ")}`);

	// 5. ## Currently working on Experiment
	sections.push(`## Currently working on Experiment #${experiment.number} — ${experiment.title}`);

	// 6. ## Run History (conditional — only when there are runs with metrics)
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

	// 7. ## Context Summary (conditional — memory summaries from MEMORY.md)
	if (memorySummaries.length > 0) {
		const summaryLines = memorySummaries.map((s) => `[${s.level}] ${s.content}`);
		sections.push(`## Context Summary\n${summaryLines.join("\n\n")}`);
	}

	// 8. ## Conversation — full thread on first run, latest user msg on resume
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
