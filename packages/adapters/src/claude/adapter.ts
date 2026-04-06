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
		const args = [
			"claude",
			"-p",
			"-",
			"--output-format",
			"stream-json",
			"--verbose",
			"--dangerously-skip-permissions",
		];
		if (sessionId) {
			args.push("--resume", sessionId);
		}
		return args;
	}

	parseStreamLine(line: string): string | null {
		if (!line.trim()) return null;
		try {
			const event: ClaudeEvent = JSON.parse(line);
			if (event.type === "assistant" && "message" in event) {
				const toolLabels: Record<string, string> = {
					Write: "Writing",
					Edit: "Editing",
					Read: "Reading",
					Bash: "Running",
					Glob: "Searching",
					Grep: "Searching",
				};

				// Check for tool_use blocks in assistant message
				const toolBlock = event.message.content.find((b) => b.type === "tool_use") as
					| { type: string; name?: string; input?: Record<string, unknown> }
					| undefined;
				if (toolBlock?.name) {
					const label = toolLabels[toolBlock.name] ?? toolBlock.name;
					const input = toolBlock.input as { file_path?: string; command?: string } | undefined;
					const detail = input?.file_path ?? input?.command?.slice(0, 60);
					return detail ? `🔧 ${label}: \`${detail}\`` : `🔧 ${label}...`;
				}

				// Check for text blocks
				const texts = event.message.content
					.filter((b) => b.type === "text" && b.text)
					.map((b) => b.text!);
				return texts.length > 0 ? texts.join("") : null;
			}
		} catch {
			/* ignore */
		}
		return null;
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
