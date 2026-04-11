import type { AgentAdapter } from "@quantdesk/adapters";
import type { StrategyMode } from "@quantdesk/shared";
import { buildAnalystPrompt, buildRiskManagerPrompt } from "./prompt-builder.js";
import type { PaperSessionContext } from "./prompts/types.js";

interface DeskContext {
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
	strategyMode: StrategyMode;
	engine: string;
	venues: string[];
	description: string | null;
}

interface MetricEntry {
	key: string;
	label: string;
	value: number;
	format: string;
	tone?: string;
}

interface RunInput {
	desk: DeskContext;
	experiment: { number: number; title: string };
	runs: Array<{
		runNumber: number;
		isBaseline: boolean;
		result: { metrics: MetricEntry[] } | null;
	}>;
	comments: Array<{ author: string; content: string }>;
	memorySummaries: Array<{ level: string; content: string }>;
	paperSession?: PaperSessionContext | null;
	sessionId: string | undefined;
	agentRole: "analyst" | "risk_manager";
	runResult?: { metrics: MetricEntry[] };
	validationRunNumber?: number;
	/** Phase 27b — optional MCP config path passed through to the adapter. */
	mcpConfigPath?: string;
	/** Per-turn CLI settings file carrying workspace-sandbox deny rules. */
	settingsPath?: string;
}

interface RunResult {
	sessionId: string;
	resultText: string;
	usage: { inputTokens: number; outputTokens: number; costUsd?: number };
	error?: string;
}

type SpawnFn = (args: string[], stdin: string) => Promise<string[]>;

export class AgentRunner {
	constructor(
		private adapter: AgentAdapter,
		private spawn: SpawnFn,
	) {}

	async run(input: RunInput): Promise<RunResult> {
		// Detect user language from the last user comment for RM prompt.
		const lastUserComment = [...input.comments].reverse().find((c) => c.author === "user");
		const userLanguageHint = lastUserComment
			? /[\uAC00-\uD7AF]/.test(lastUserComment.content)
				? "Korean"
				: undefined
			: undefined;

		const prompt =
			input.agentRole === "risk_manager" &&
			input.runResult &&
			typeof input.validationRunNumber === "number"
				? buildRiskManagerPrompt({
						desk: input.desk,
						runNumber: input.validationRunNumber,
						runResult: input.runResult,
						userLanguageHint,
					})
				: buildAnalystPrompt({
						desk: input.desk,
						experiment: input.experiment,
						runs: input.runs,
						comments: input.comments,
						memorySummaries: input.memorySummaries,
						paperSession: input.paperSession,
						isResume: !!input.sessionId,
					});

		const args = this.adapter.buildSpawnArgs(
			prompt,
			input.sessionId,
			input.mcpConfigPath,
			input.settingsPath,
		);

		try {
			const outputLines = await this.spawn(args, prompt);
			const parsed = this.adapter.parseOutputStream(outputLines);

			return {
				sessionId: parsed.sessionId,
				resultText: parsed.resultText,
				usage: parsed.usage,
			};
		} catch (err) {
			return {
				sessionId: input.sessionId ?? "",
				resultText: "",
				usage: { inputTokens: 0, outputTokens: 0 },
				error: err instanceof Error ? err.message : "Unknown error",
			};
		}
	}
}
