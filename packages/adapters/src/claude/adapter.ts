import type { AgentAdapter, SpawnResult, StreamChunk } from "../types.js";

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

	parseStreamLine(line: string): StreamChunk | null {
		if (!line.trim()) return null;
		try {
			const event = JSON.parse(line) as Record<string, unknown>;

			// Tool result from "user" event
			if (event.type === "user" && event.tool_use_result) {
				const result = event.tool_use_result as Record<string, unknown>;
				const content = (result.stdout as string) ?? (result.content as string) ?? "";
				if (content) {
					return { type: "tool_result", content: content.slice(0, 500) };
				}
				return null;
			}

			const assistantEvent = event as unknown as ClaudeEvent;
			if (assistantEvent.type === "assistant" && "message" in assistantEvent) {
				const toolLabels: Record<string, string> = {
					Write: "Writing",
					Edit: "Editing",
					Read: "Reading",
					Bash: "Running",
					Glob: "Searching",
					Grep: "Searching",
				};

				// Check for tool_use blocks in assistant message
				const toolBlock = assistantEvent.message.content.find((b) => b.type === "tool_use") as
					| { type: string; name?: string; input?: Record<string, unknown> }
					| undefined;
				if (toolBlock?.name) {
					const label = toolLabels[toolBlock.name] ?? toolBlock.name;
					const input = toolBlock.input as
						| {
								file_path?: string;
								command?: string;
								content?: string;
								old_string?: string;
								new_string?: string;
						  }
						| undefined;
					let detail = input?.file_path ?? input?.command?.slice(0, 80);
					if (detail && input?.file_path) {
						const parts = detail.split("/");
						detail = parts.slice(-2).join("/");
					}
					// Build expandable content for detail view
					let expandable: string | undefined;
					if (toolBlock.name === "Bash" && input?.command) {
						expandable = input.command;
					} else if (toolBlock.name === "Write" && input?.content) {
						expandable = input.content.slice(0, 500);
					} else if (toolBlock.name === "Edit" && input?.new_string) {
						expandable = input.new_string.slice(0, 300);
					}
					return {
						type: "tool",
						content: detail ? `${label}: ${detail}` : `${label}...`,
						tool: toolBlock.name,
						label,
						detail,
						expandable,
					};
				}

				// Check for text blocks
				const texts = assistantEvent.message.content
					.filter((b) => b.type === "text" && b.text)
					.map((b) => b.text!);
				if (texts.length > 0) {
					return { type: "text", content: texts.join("") };
				}
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
