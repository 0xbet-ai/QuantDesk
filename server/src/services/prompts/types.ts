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

export interface RiskManagerPromptInput {
	desk: DeskContext;
	runNumber: number;
	runResult: { metrics: MetricEntry[] };
	/** Language hint derived from the last user comment, e.g. "Korean", "English". */
	userLanguageHint?: string;
}
