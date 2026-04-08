/**
 * Shared input types for the prompt builder blocks.
 *
 * Each block file imports from here so the orchestrator
 * (`prompt-builder.ts`) can pass the same context object through to every
 * block.
 */

export interface DeskContext {
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
	strategyMode: "classic" | "realtime";
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

export interface AnalystPromptInput {
	desk: DeskContext;
	experiment: ExperimentContext;
	runs: RunContext[];
	comments: CommentContext[];
	memorySummaries: MemorySummary[];
	isResume?: boolean;
}

export interface RiskManagerPromptInput {
	desk: DeskContext;
	runResult: { metrics: MetricEntry[] };
}
