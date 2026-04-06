import type { AgentAdapter, SpawnResult } from "../types.js";

interface ClaudeSystemEvent {
	type: "system";
	session_id: string;
}

interface ClaudeAssistantEvent {
	type: "assistant";
	message: {
		content: Array<{ type: string; text?: string }>;
		usage: { input_tokens: number; output_tokens: number };
	};
	session_id: string;
}

interface ClaudeResultEvent {
	type: "result";
	result: string;
	session_id: string;
	usage: { input_tokens: number; output_tokens: number };
	total_cost_usd?: number;
}

type ClaudeEvent = ClaudeSystemEvent | ClaudeAssistantEvent | ClaudeResultEvent;

export class ClaudeAdapter implements AgentAdapter {
	readonly name = "claude";

	buildSpawnArgs(_prompt: string, sessionId?: string): string[] {
		const args = ["claude", "--print", "-", "--output-format", "stream-json", "--verbose"];
		if (sessionId) {
			args.push("--resume", sessionId);
		}
		return args;
	}

	parseOutputStream(lines: string[]): SpawnResult {
		let sessionId = "";
		let resultText = "";
		let inputTokens = 0;
		let outputTokens = 0;
		let costUsd: number | undefined;

		for (const line of lines) {
			if (!line.trim()) continue;
			let event: ClaudeEvent;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}

			if (event.type === "system" && "session_id" in event) {
				sessionId = event.session_id;
			}

			if (event.type === "result") {
				resultText = event.result;
				sessionId = event.session_id;
				inputTokens = event.usage.input_tokens;
				outputTokens = event.usage.output_tokens;
				costUsd = event.total_cost_usd;
			}
		}

		if (!sessionId) {
			throw new Error("Failed to parse Claude output: no session_id found");
		}

		return {
			sessionId,
			resultText,
			usage: { inputTokens, outputTokens, costUsd },
		};
	}
}
