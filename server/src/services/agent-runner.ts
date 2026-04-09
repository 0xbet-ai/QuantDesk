import type { AgentAdapter } from "@quantdesk/adapters";
import type { StrategyMode } from "@quantdesk/shared";
import { buildAnalystPrompt, buildRiskManagerPrompt } from "./prompt-builder.js";

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
	sessionId: string | undefined;
	agentRole: "analyst" | "risk_manager";
	runResult?: { metrics: MetricEntry[] };
	/** Phase 27b — optional MCP config path passed through to the adapter. */
	mcpConfigPath?: string;
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
		const prompt =
			input.agentRole === "risk_manager" && input.runResult
				? buildRiskManagerPrompt({ desk: input.desk, runResult: input.runResult })
				: buildAnalystPrompt({
						desk: input.desk,
						experiment: input.experiment,
						runs: input.runs,
						comments: input.comments,
						memorySummaries: input.memorySummaries,
						isResume: !!input.sessionId,
					});

		const args = this.adapter.buildSpawnArgs(prompt, input.sessionId, input.mcpConfigPath);

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
