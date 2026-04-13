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
import type {
	AnalystPromptInput,
	CommentContext,
	DeskContext,
	PaperSessionContext,
} from "./prompts/index.js";

/**
 * Render the current paper session snapshot as a prompt block. Three
 * shapes:
 *   - undefined: block not injected at all (caller didn't query)
 *   - null: no paper session has ever run (explicitly say so)
 *   - object: current/last row with status, started/stopped, error
 *
 * When status is `running`, the block explicitly tells the agent to
 * call `get_paper_status` to read live PnL — this block itself is
 * snapshotted at turn start and does not reflect live container health.
 */
function buildPaperSessionBlock(session: PaperSessionContext | null): string {
	if (session === null) {
		return "## Paper session\nNo paper session has ever run on this desk.";
	}
	const lines: string[] = ["## Paper session", `- Status: ${session.status}`];
	if (session.runNumber !== null) {
		lines.push(`- Promoted from: Run #${session.runNumber}`);
	}
	lines.push(`- Started: ${session.startedAt}`);
	if (session.stoppedAt) {
		lines.push(`- Stopped: ${session.stoppedAt}`);
	}
	if (session.error) {
		lines.push(`- Error: ${session.error}`);
	}
	if (session.status === "running") {
		lines.push(
			"- **This row is a snapshot.** For live PnL / open positions, call `mcp__quantdesk__get_paper_status` — never claim the container is running without verifying on the current turn.",
		);
	} else {
		lines.push(
			"- The session is NOT running. Do not tell the user it is. If they ask about paper trading, reference this row (and call `get_paper_status` if you need the full history).",
		);
	}
	return lines.join("\n");
}

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

	// 4b. ## Paper session — current state injected every turn so the
	//     agent never hallucinates "still running" from stale session
	//     context. If anything changed since the last turn (stopped,
	//     failed, started), this block is the agent's ground truth. For
	//     live PnL / positions the agent still has to call
	//     get_paper_status — this block only carries the session row.
	if (input.paperSession !== undefined) {
		sections.push(buildPaperSessionBlock(input.paperSession));
	}

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

	// 7. ## Context Summary — past experiment learnings injected into the
	//    prompt so the analyst doesn't repeat failed hypotheses or forget
	//    validated ones. Token-budgeted: if the combined summaries exceed
	//    MEMORY_TOKEN_BUDGET, older experiment summaries are dropped
	//    (most-recent-first priority) while desk-level summaries are
	//    always kept (they're the most compressed / highest-signal layer).
	if (memorySummaries.length > 0) {
		const MEMORY_TOKEN_BUDGET = 4000;
		// Separate desk-level (always keep) from experiment-level (trim oldest first)
		const deskSummaries = memorySummaries.filter((s) => s.level === "desk");
		const expSummaries = memorySummaries.filter((s) => s.level !== "desk");
		// Reverse experiment summaries so most recent is first (will be kept on trim)
		const expReversed = [...expSummaries].reverse();

		// Always include desk summaries
		const kept: typeof memorySummaries = [...deskSummaries];
		let tokens = deskSummaries.reduce((sum, s) => sum + estimateTokens(`[${s.level}] ${s.content}`), 0);

		// Add experiment summaries newest-first until budget is hit
		for (const s of expReversed) {
			const cost = estimateTokens(`[${s.level}] ${s.content}`);
			if (tokens + cost > MEMORY_TOKEN_BUDGET) break;
			tokens += cost;
			kept.push(s);
		}

		if (kept.length > 0) {
			const summaryLines = kept.map((s) => `[${s.level}] ${s.content}`);
			sections.push(`## Context Summary (past experiments)\n${summaryLines.join("\n\n")}`);
		}
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
		// (e.g. pivot to a different fetch approach on a data failure).
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
