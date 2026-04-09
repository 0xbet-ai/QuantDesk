/**
 * Prompt orchestrator. Each prompt block lives in its own file under
 * `./prompts/`. This file stays thin: it composes blocks in order, plus
 * the per-turn helpers (`estimateTokens`, `trimCommentsToTokenBudget`).
 */

import {
	buildAnalystSystemBlock,
	buildClassicModeBlock,
	buildFailureEscalationBlock,
	buildGenericModeBlock,
	buildLifecycleRulesBlock,
	buildRealtimeModeBlock,
	buildToolsGlossaryBlock,
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
 * mode is immutable per desk (CLAUDE.md rule #8) so this resolution is
 * stable for the desk's lifetime.
 */
function buildModeInstructions(desk: DeskContext): string {
	return desk.strategyMode === "realtime" ? buildRealtimeModeBlock() : buildClassicModeBlock();
}

/**
 * Compose the analyst prompt by concatenating blocks in order. Each block
 * knows its own invariants; this function only knows the order.
 */
export function buildAnalystPrompt(input: AnalystPromptInput): string {
	const { desk, experiment, runs, comments, memorySummaries } = input;

	const sections: string[] = [];

	// 1. analyst.system — identity, rules, workspace, conversational
	//    approval, never-give-up.
	sections.push(buildAnalystSystemBlock());

	// 2. tools glossary — MCP tool catalog (single source of truth for
	//    which tools exist and which need prior consent).
	sections.push(buildToolsGlossaryBlock());

	// 3. mode-{classic|realtime} — execution model + data acquisition
	//    protocol. Engine-agnostic; the framework contract lives in
	//    the seeded strategy.py.
	sections.push(buildModeInstructions(desk));

	// 3b. If the desk's venue has no managed engine for the chosen
	//     mode, the engine resolved to `generic` — append a short
	//     block telling the agent there is no managed runner so it
	//     owns the execution entrypoint too.
	if (desk.engine === "generic") {
		sections.push(buildGenericModeBlock());
	}

	// 4. lifecycle rules — title / new_experiment / complete_experiment
	//    policies. Cross-mode, tool-driven.
	sections.push(buildLifecycleRulesBlock());

	// 5. analyst.failure-escalation — conditional ralph-loop pressure.
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

	// 8. ## Conversation — full thread on first run, diff since last turn on resume
	if (input.isResume) {
		// Everything after the last analyst comment is "new since your last
		// turn" and MUST be injected. This includes system comments such as
		// "Downloaded …", "Data-fetch failed …", "Backtest Run #N failed …" —
		// they represent server-side side effects that happened while the
		// agent was away. Previously this branch filtered out `system`
		// authors and kept only the last user comment, which meant the agent
		// resumed blind after every approval/failure and had no way to react
		// (e.g. pivot to Path B on a data-fetch failure).
		let lastAnalystIdx = -1;
		for (let i = comments.length - 1; i >= 0; i--) {
			if (comments[i]!.author === "analyst") {
				lastAnalystIdx = i;
				break;
			}
		}
		const newSinceLastTurn = comments.slice(lastAnalystIdx + 1);
		if (newSinceLastTurn.length > 0) {
			const lines = newSinceLastTurn.map((c) => `[${c.author}] ${c.content}`);
			sections.push(`## New since your last turn\n${lines.join("\n\n")}`);
		}
	} else {
		const userComments = comments.filter((c) => c.author !== "system");
		const trimmedComments = trimCommentsToTokenBudget(userComments, 4000);
		if (trimmedComments.length > 0) {
			const commentLines = trimmedComments.map((c) => `[${c.author}] ${c.content}`);
			sections.push(`## Conversation\n${commentLines.join("\n\n")}`);
		}
	}

	return sections.join("\n\n");
}
