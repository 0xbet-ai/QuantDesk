/**
 * Shared input types for the prompt builder blocks.
 *
 * Each block file imports from here so the orchestrator
 * (`prompt-builder.ts`) can pass the same context object through to every
 * block.
 */

import type { StrategyMode } from "@quantdesk/shared";

export interface DeskContext {
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
	strategyMode: StrategyMode;
	/** Resolved engine: freqtrade | nautilus | generic. */
	engine: string;
	venues: string[];
	description: string | null;
}

export interface ExperimentContext {
	number: number;
	title: string;
}

export interface MetricEntry {
	key: string;
	label: string;
	value: number;
	format: string;
	tone?: string;
}

export interface RunContext {
	runNumber: number;
	isBaseline: boolean;
	result: { metrics: MetricEntry[] } | null;
}

export interface CommentContext {
	author: string;
	content: string;
}

export interface MemorySummary {
	level: string;
	content: string;
}

/**
 * Current paper session snapshot, injected into the resume prompt so
 * the agent never has to guess whether the container is still alive.
 * `null` means "no paper session has ever run on this desk".
 */
export interface PaperSessionContext {
	status: "pending" | "running" | "stopped" | "failed";
	runNumber: number | null;
	startedAt: string;
	stoppedAt: string | null;
	error: string | null;
}

export interface AnalystPromptInput {
	desk: DeskContext;
	experiment: ExperimentContext;
	runs: RunContext[];
	comments: CommentContext[];
	memorySummaries: MemorySummary[];
	paperSession?: PaperSessionContext | null;
	isResume?: boolean;
}

/**
 * Strategy code diff surfaced to the RM so it can judge WHAT CHANGED
 * between runs, not just the metric jump. Without this the RM can only
 * guess from the conversation whether a sudden return spike was caused
 * by an intentional edit (new indicator, tuned threshold) or an
 * unintended refactor that smuggled in lookahead bias.
 *
 * Both diffs are optional strings because any of the comparison
 * commits may be missing (baseline has no predecessor; git
 * introspection can fail and must not block validation).
 */
export interface CodeDiffContext {
	/** Commit hash attached to the target run. null when git stamping failed. */
	targetCommit: string | null;
	/** Diff between the target run and the run immediately before it. null for baseline. */
	againstPrevious: string | null;
	/** Diff between the target run and the baseline (Run #1). null for the baseline itself. */
	againstBaseline: string | null;
	/** Short one-line label showing which runs were compared ("Run #3 vs Run #2"). */
	previousLabel: string | null;
	/** Short one-line label for the baseline comparison ("Run #3 vs Run #1 (baseline)"). */
	baselineLabel: string | null;
	/** True when either diff was truncated to fit the token budget. */
	truncated: boolean;
}

/**
 * A single condensed chunk from the analyst's recent turn stream —
 * `thinking`, `tool_call`, or `text` — pulled from the per-experiment
 * JSONL log. The RM reads these to see the analyst's reasoning and
 * tool usage BEFORE the run that's now in front of it for validation.
 */
export interface AnalystTrailChunk {
	type: "thinking" | "tool_call" | "text";
	content: string;
	/** Tool name when `type === "tool_call"`. */
	name?: string;
}

export interface RiskManagerPromptInput {
	desk: DeskContext;
	experiment: ExperimentContext;
	/** The run currently being validated. */
	runNumber: number;
	runResult: { metrics: MetricEntry[] };
	/**
	 * Full run history for the experiment. Lets the RM compare the
	 * target run to its siblings — a sudden jump in return that no
	 * prior run shows is a much stronger overfit signal than a lone
	 * metric table. Includes the target run itself so the RM can see
	 * where it sits in the distribution.
	 */
	runs: RunContext[];
	/**
	 * Experiment comment thread (user + analyst + system). Gives the RM
	 * the hypothesis context — what the analyst was trying to do, what
	 * the user asked for, whether the same strategy was already rejected
	 * in a previous verdict. Passed through the same token-budget trim
	 * the analyst prompt uses.
	 */
	comments: CommentContext[];
	/** Desk-level long-term memory summaries. */
	memorySummaries: MemorySummary[];
	/**
	 * Strategy code diff for the target run. Optional — callers without
	 * access to the desk workspace (unit tests, bare dispatches) may
	 * omit this and the prompt will skip the block.
	 */
	codeDiff?: CodeDiffContext | null;
	/**
	 * Analyst reasoning trail leading up to the target run. Optional
	 * for the same reason as `codeDiff`. The prompt renders the chunks
	 * in order so the RM sees the analyst's thinking + tool calls.
	 */
	analystTrail?: AnalystTrailChunk[] | null;
	/** Language hint derived from the last user comment, e.g. "Korean", "English". */
	userLanguageHint?: string;
}
