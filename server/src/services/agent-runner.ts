import type { AgentAdapter } from "@quantdesk/adapters";
import { buildAnalystPrompt, buildRiskManagerPrompt } from "./prompt-builder.js";

interface DeskContext {
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
	engine: string;
	venues: string[];
	description: string | null;
}

interface RunInput {
	desk: DeskContext;
	experiment: { number: number; title: string };
	runs: Array<{
		runNumber: number;
		isBaseline: boolean;
		result: { returnPct: number; drawdownPct: number; winRate: number; totalTrades: number } | null;
	}>;
	comments: Array<{ author: string; content: string }>;
	memorySummaries: Array<{ level: string; content: string }>;
	sessionId: string | undefined;
	agentRole: "analyst" | "risk_manager";
	runResult?: { returnPct: number; drawdownPct: number; winRate: number; totalTrades: number };
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
					});

		const args = this.adapter.buildSpawnArgs(prompt, input.sessionId);

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
