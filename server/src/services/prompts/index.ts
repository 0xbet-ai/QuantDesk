/**
 * Barrel for the prompt block modules.
 *
 * The orchestrator (`server/src/services/prompt-builder.ts`) imports from
 * this barrel and assembles the final prompt by composing the blocks.
 */

export { buildAnalystSystemBlock } from "./analyst-system.js";
export { buildToolsGlossaryBlock } from "./tools-glossary.js";
export { buildLifecycleRulesBlock } from "./lifecycle-rules.js";
export { buildClassicModeBlock } from "./mode-classic.js";
export { buildRealtimeModeBlock } from "./mode-realtime.js";
export { buildGenericModeBlock } from "./mode-generic.js";
export {
	buildFailureEscalationBlock,
	countRecentFailureStreak,
} from "./failure-escalation.js";
export { buildRiskManagerPrompt } from "./risk-manager.js";

export type {
	AnalystPromptInput,
	CommentContext,
	DeskContext,
	ExperimentContext,
	MemorySummary,
	MetricEntry,
	RiskManagerPromptInput,
	RunContext,
} from "./types.js";
